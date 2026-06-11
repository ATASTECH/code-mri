import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import type { ProjectRepoRole, Report } from "../types.js";
import {
  askGraph,
  checkBreakingChanges,
  createAgentQueryContext,
  findDeadCode,
  finalizeAgentResult,
  getNodeContext,
  graphSearch,
  impactQuery,
  prepareEditContext,
  readWindows,
  recommendTests,
  reviewDiff,
  reviewPlannedChange,
  type AgentQueryContext,
  type AgentToolResult,
} from "../agent/index.js";
import { analyzeProject } from "../pipeline/analyze.js";
import { analyzeProjectRepos, type ProjectRepoInput } from "../pipeline/analyzeRepos.js";

const ENGINE_VERSION =
  (createRequire(import.meta.url)("../../package.json") as { version?: string }).version ?? "0.0.0";

interface JsonRpcRequest {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

const AGENT_RESULT_REQUIRED = ["tool", "plan", "confidence", "loc", "message"];

const COMMON_CONTEXT_PROPERTIES = {
  detail: { type: "string", enum: ["brief", "standard", "full"] },
  tokenBudget: { type: "number" },
  includeEvidence: { type: "boolean" },
  cursor: { type: "string" },
};

const AGENT_RESULT_SCHEMA = {
  type: "object",
  required: AGENT_RESULT_REQUIRED,
  additionalProperties: true,
  properties: {
    tool: { type: "string" },
    plan: { type: "array", items: { type: "string" } },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    loc: { type: ["object", "null"] },
    message: { type: "string" },
  },
};

const ACTIVE_REPORT_SCHEMA = {
  type: "object",
  required: ["project", "root", "health", "issues", "nodes", "edges"],
  properties: {
    project: { type: "string" },
    root: { type: "string" },
    health: { type: "number" },
    issues: { type: "number" },
    nodes: { type: "number" },
    edges: { type: "number" },
  },
};

const SCAN_RESULT_SCHEMA = {
  type: "object",
  required: [...AGENT_RESULT_REQUIRED, "activeReport", "diff"],
  properties: {
    ...AGENT_RESULT_SCHEMA.properties,
    activeReport: { type: "object" },
    diff: { type: ["object", "null"] },
  },
};

const TOOL_SCHEMAS = [
  {
    name: "impact_query",
    description: "Find nodes impacted if a report node changes. Uses the existing report graph; never scans.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        ...COMMON_CONTEXT_PROPERTIES,
        nodeId: { type: "string" },
        query: { type: "string" },
        limit: { type: "number" },
      },
    },
    outputSchema: AGENT_RESULT_SCHEMA,
  },
  {
    name: "graph_search",
    description: "Search report graph nodes by id, name, kind, or source file.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        ...COMMON_CONTEXT_PROPERTIES,
        query: { type: "string" },
        kinds: { type: "array", items: { type: "string" } },
        limit: { type: "number" },
      },
    },
    outputSchema: AGENT_RESULT_SCHEMA,
  },
  {
    name: "find_dead_code",
    description: "Return existing dead-code and unused-endpoint candidates from the report.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        ...COMMON_CONTEXT_PROPERTIES,
        confidence: { type: "string", enum: ["high", "medium", "low"] },
        limit: { type: "number" },
      },
    },
    outputSchema: AGENT_RESULT_SCHEMA,
  },
  {
    name: "check_breaking_changes",
    description: "Return BREAKING_* issues and baseline diff breaking changes when a baseline report is provided.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: { type: "object", properties: { ...COMMON_CONTEXT_PROPERTIES, limit: { type: "number" } } },
    outputSchema: AGENT_RESULT_SCHEMA,
  },
  {
    name: "get_node_context",
    description: "Return a node with incoming/outgoing edges and attached issues.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        ...COMMON_CONTEXT_PROPERTIES,
        nodeId: { type: "string" },
        query: { type: "string" },
        limit: { type: "number" },
      },
    },
    outputSchema: AGENT_RESULT_SCHEMA,
  },
  {
    name: "ask_graph",
    description: "Deterministically route a natural-language question to one graph tool and return the sourced result.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      required: ["question"],
      properties: {
        ...COMMON_CONTEXT_PROPERTIES,
        question: { type: "string" },
        limit: { type: "number" },
      },
    },
    outputSchema: {
      type: "object",
      required: [...AGENT_RESULT_REQUIRED, "result"],
      additionalProperties: true,
      properties: {
        ...AGENT_RESULT_SCHEMA.properties,
        result: { type: "object", additionalProperties: true },
      },
    },
  },
  {
    name: "recommend_tests",
    description: "Recommend focused verification commands for a changed node, query, or file list from the active report.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        ...COMMON_CONTEXT_PROPERTIES,
        nodeId: { type: "string" },
        query: { type: "string" },
        files: { type: "array", items: { type: "string" } },
        limit: { type: "number" },
      },
    },
    outputSchema: AGENT_RESULT_SCHEMA,
  },
  {
    name: "prepare_edit_context",
    description: "Prepare a token-budgeted edit plan: must-read line windows, impacts, risks, tests, and next tool calls.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      required: ["task"],
      properties: {
        ...COMMON_CONTEXT_PROPERTIES,
        task: { type: "string" },
        files: { type: "array", items: { type: "string" } },
        nodeIds: { type: "array", items: { type: "string" } },
        maxFiles: { type: "number" },
        maxWindows: { type: "number" },
      },
    },
    outputSchema: AGENT_RESULT_SCHEMA,
  },
  {
    name: "read_windows",
    description: "Return bounded source line windows. Use mode=locations for coordinates only; secret candidates are redacted.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      required: ["windows"],
      properties: {
        ...COMMON_CONTEXT_PROPERTIES,
        windows: { type: "array", items: { type: "object" } },
        mode: { type: "string", enum: ["source", "locations", "outline"] },
        includeSource: { type: "boolean" },
        maxWindows: { type: "number" },
        maxLines: { type: "number" },
        maxChars: { type: "number" },
      },
    },
    outputSchema: AGENT_RESULT_SCHEMA,
  },
  {
    name: "review_planned_change",
    description: "Review an agent's planned change before editing and return blocking risks, checks, and verification commands.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      required: ["plan"],
      properties: {
        ...COMMON_CONTEXT_PROPERTIES,
        plan: { type: "string" },
        files: { type: "array", items: { type: "string" } },
        nodeIds: { type: "array", items: { type: "string" } },
      },
    },
    outputSchema: AGENT_RESULT_SCHEMA,
  },
  {
    name: "review_diff",
    description: "Review changed files or a unified diff against the active graph and return risk and test guidance.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        ...COMMON_CONTEXT_PROPERTIES,
        diffText: { type: "string" },
        files: { type: "array", items: { type: "string" } },
      },
    },
    outputSchema: AGENT_RESULT_SCHEMA,
  },
];

const MUTATING_TOOL_SCHEMAS = [
  {
    name: "scan_project",
    description:
      "Run a live Code MRI scan and make the new report the active MCP context. Exposed only with --allow-scan.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        name: { type: "string" },
        repos: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "root"],
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              root: { type: "string" },
              role: { type: "string" },
            },
          },
        },
        reportPath: { type: "string" },
        baselinePath: { type: "string" },
        updateBaseline: { type: "boolean" },
        cacheDir: { type: "string" },
        configPath: { type: "string" },
        openapi: { type: "string" },
        coverage: { type: "string" },
        python: { type: "string" },
        noGit: { type: "boolean" },
        maxGitCommits: { type: "number" },
        noCache: { type: "boolean" },
      },
    },
    outputSchema: SCAN_RESULT_SCHEMA,
  },
  {
    name: "load_report",
    description:
      "Load a report JSON file into the active MCP context. Exposed only with --allow-scan.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      required: ["reportPath"],
      properties: {
        reportPath: { type: "string" },
        baselinePath: { type: "string" },
      },
    },
    outputSchema: SCAN_RESULT_SCHEMA,
  },
];

export interface McpScanDefaults {
  cacheDir?: string;
  configPath?: string;
  openapi?: string;
  coverage?: string;
  python?: string;
  reportPath?: string;
  baselinePath?: string;
  git?: boolean;
  maxGitCommits?: number;
  noCache?: boolean;
}

export interface McpContext {
  agent?: AgentQueryContext;
  allowScan: boolean;
  scanDefaults: McpScanDefaults;
  textMode: McpTextMode;
  seenPayloadHashes: Set<string>;
}

export type McpTextMode = "summary" | "json";

function toolArguments(params: Record<string, unknown> | undefined): Record<string, unknown> {
  const args = params?.arguments;
  return args && typeof args === "object" && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {};
}

function readReport(file: string): Report {
  return JSON.parse(readFileSync(path.resolve(file), "utf8")) as Report;
}

function writeJson(file: string, value: unknown): void {
  const out = path.resolve(file);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(value, null, 2));
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function boolArg(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  return typeof value === "boolean" ? value : undefined;
}

function numberArg(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isAgentToolResult(value: unknown): value is AgentToolResult {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { tool?: unknown }).tool === "string" &&
      Array.isArray((value as { plan?: unknown }).plan),
  );
}

function contentText(result: unknown, mode: McpTextMode): string {
  if (mode === "json") return JSON.stringify(result);
  if (!isAgentToolResult(result)) return "Code MRI MCP result ready.";
  const stats = (result as { resultStats?: { estimatedTokens?: number; omitted?: Record<string, number> } }).resultStats;
  const omitted = stats?.omitted
    ? Object.entries(stats.omitted)
        .filter(([, count]) => count > 0)
        .map(([key, count]) => `${count} ${key}`)
        .join(", ")
    : "";
  const lines = [
    result.message ?? `${result.tool} completed.`,
    `tool=${result.tool}`,
    `confidence=${result.confidence}`,
    stats?.estimatedTokens ? `estimatedTokens=${stats.estimatedTokens}` : "",
    omitted ? `omitted=${omitted}` : "",
  ]
    .filter(Boolean);

  const nodeRows = [
    ...((result.nodes ?? []).map((node) => ["node", node.id, node.kind, node.loc?.file ?? "", node.confidence])),
    ...((result.candidates ?? []).map((node) => ["candidate", node.id, node.kind, node.loc?.file ?? "", node.confidence])),
    ...((result.impacts ?? []).map((node) => ["impact", node.id, node.kind, node.loc?.file ?? "", node.confidence])),
  ].slice(0, 12);
  if (nodeRows.length) {
    lines.push("kind\tid\tnodeKind\tfile\tconfidence", ...nodeRows.map((row) => row.join("\t")));
  }

  const issueRows = [
    ...((result.issues ?? []).map((issue) => ["issue", issue.kind, issue.severity, issue.loc?.file ?? "", issue.message])),
    ...((result.risks ?? []).map((issue) => ["risk", issue.kind, issue.severity, issue.loc?.file ?? "", issue.message])),
    ...((result.breakingChanges ?? []).map((issue) => ["breaking", issue.kind, issue.severity, issue.loc?.file ?? "", issue.message])),
  ].slice(0, 8);
  if (issueRows.length) {
    lines.push("kind\tissueKind\tseverity\tfile\tmessage", ...issueRows.map((row) => row.join("\t")));
  }

  const testRows = [...(result.testCommands ?? []), ...(result.testPlan ?? []), ...(result.verificationCommands ?? [])]
    .slice(0, 8)
    .map((command) => ["test", command.confidence, command.command, command.reason]);
  if (testRows.length) {
    lines.push("kind\tconfidence\tcommand\treason", ...testRows.map((row) => row.join("\t")));
  }

  const windowRows = [
    ...(result.mustRead ?? []).map((window) => ["mustRead", window] as const),
    ...(result.maybeReadLater ?? []).map((window) => ["maybeReadLater", window] as const),
  ]
    .slice(0, 12)
    .map(([kind, window]) =>
      [kind, window.file, `${window.startLine}-${window.endLine}`, window.reasonCode ?? "", window.confidence].join("\t"),
    );
  if (windowRows.length) {
    lines.push("kind\tfile\tlines\treasonCode\tconfidence", ...windowRows);
  }

  if (typeof result.safeToProceed === "boolean") lines.push(`safeToProceed=${result.safeToProceed}`);
  for (const item of (result.mustFix ?? []).slice(0, 8)) lines.push(`mustFix\t${item}`);
  for (const item of (result.shouldCheck ?? []).slice(0, 8)) lines.push(`shouldCheck\t${item}`);

  for (const window of (result.windows ?? []).slice(0, 12)) {
    const header = `--- ${window.file}:${window.startLine}-${window.endLine}${window.redacted ? " [redacted]" : ""}`;
    if (window.source !== undefined) {
      lines.push(header, window.source);
    } else {
      lines.push(`${header} (${window.message ?? "source omitted"})`);
    }
  }

  for (const next of (result.nextQueries ?? []).slice(0, 3)) {
    lines.push(`nextQuery\t${next.tool}\t${next.reason}`);
  }

  return lines.join("\n");
}

// "windows" is intentionally NOT deduped: a repeated read_windows call is a
// legitimate re-read (e.g. after agent context compaction) and must return source.
const DEDUPE_ARRAY_KEYS = [
  "nodes",
  "candidates",
  "impacts",
  "edges",
  "issues",
  "risks",
  "breakingChanges",
] as const;

function payloadHash(value: unknown): string {
  return createHash("sha1").update(JSON.stringify(value)).digest("hex");
}

function dedupeItem(item: unknown, hash: string): unknown {
  if (!item || typeof item !== "object" || Array.isArray(item)) return item;
  const obj = item as Record<string, unknown>;
  const out: Record<string, unknown> = {
    deduped: true,
    hash,
  };
  for (const key of ["id", "kind", "name", "loc", "file", "startLine", "endLine", "confidence", "severity", "message"]) {
    if (key in obj) out[key] = obj[key];
  }
  return out;
}

function dedupeStructuredContent(ctx: McpContext, result: AgentToolResult): AgentToolResult {
  const alreadySeen = new Set(ctx.seenPayloadHashes);
  let deduped = 0;
  const out = { ...result } as AgentToolResult & Record<string, unknown>;
  const record = out as Record<string, unknown>;

  for (const key of DEDUPE_ARRAY_KEYS) {
    const value = record[key];
    if (!Array.isArray(value)) continue;
    record[key] = value.map((item) => {
      const hash = payloadHash(item);
      if (alreadySeen.has(hash)) {
        deduped += 1;
        return dedupeItem(item, hash);
      }
      ctx.seenPayloadHashes.add(hash);
      return item;
    });
  }

  if (out.result) out.result = dedupeStructuredContent(ctx, out.result);
  if (deduped > 0) {
    out.resultStats = {
      ...(out.resultStats ?? {
        detail: "brief",
        returned: {},
        omitted: {},
        responseBytes: 0,
        estimatedTokens: 0,
      }),
      deduped,
    } as AgentToolResult["resultStats"] & { deduped: number };
  }
  return out;
}

const ROLES = new Set<ProjectRepoRole>(["frontend", "backend", "fullstack", "worker", "other"]);

function repoInputs(value: unknown): ProjectRepoInput[] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`scan_project repos[${index}] must be an object`);
    }
    const repo = item as Record<string, unknown>;
    const id = typeof repo.id === "string" ? repo.id.trim() : "";
    const root = typeof repo.root === "string" ? repo.root.trim() : "";
    if (!id || !root) throw new Error(`scan_project repos[${index}] requires id and root`);
    const role = ROLES.has(repo.role as ProjectRepoRole) ? (repo.role as ProjectRepoRole) : "other";
    return {
      id,
      name: typeof repo.name === "string" && repo.name.trim() ? repo.name.trim() : id,
      root: path.resolve(root),
      role,
    };
  });
}

function requireAgent(ctx: McpContext): AgentQueryContext {
  if (!ctx.agent) {
    throw new Error("No active report. Call scan_project or load_report first, or start MCP with --report.");
  }
  return ctx.agent;
}

function activeReportSummary(report: Report) {
  return {
    project: report.project.name,
    root: report.project.root,
    health: report.scores.health,
    issues: report.issues.length,
    nodes: report.nodes.length,
    edges: report.edges.length,
  };
}

async function scanProjectTool(ctx: McpContext, args: Record<string, unknown>): Promise<unknown> {
  if (!ctx.allowScan) throw new Error("scan_project requires starting MCP with --allow-scan");

  const repos = repoInputs(args.repos);
  const cacheDir = stringArg(args, "cacheDir") ?? ctx.scanDefaults.cacheDir;
  const configPath = stringArg(args, "configPath") ?? ctx.scanDefaults.configPath;
  const openapi = stringArg(args, "openapi") ?? ctx.scanDefaults.openapi;
  const coverage = stringArg(args, "coverage") ?? ctx.scanDefaults.coverage;
  const python = stringArg(args, "python") ?? ctx.scanDefaults.python;
  const noCache = boolArg(args, "noCache") ?? ctx.scanDefaults.noCache;
  const noGit = boolArg(args, "noGit");
  const git = noGit === undefined ? ctx.scanDefaults.git : !noGit;
  const maxGitCommits = numberArg(args, "maxGitCommits") ?? ctx.scanDefaults.maxGitCommits;
  const baselinePath = stringArg(args, "baselinePath") ?? ctx.scanDefaults.baselinePath;
  const previous = baselinePath && existsSync(path.resolve(baselinePath)) ? readReport(baselinePath) : ctx.agent?.report;

  const report =
    repos.length > 0
      ? (
          await analyzeProjectRepos(
            { projectName: stringArg(args, "name") ?? "Code MRI MCP Project", repos },
            {
              ...(python ? { python } : {}),
              ...(openapi ? { openapi: path.resolve(openapi) } : {}),
              ...(coverage ? { coverage: path.resolve(coverage) } : {}),
              ...(configPath ? { configPath: path.resolve(configPath) } : {}),
              git,
              ...(maxGitCommits !== undefined ? { maxGitCommits } : {}),
              ...(!noCache && cacheDir ? { incrementalDir: path.resolve(cacheDir) } : {}),
            },
          )
        ).report
      : (
          await analyzeProject(path.resolve(stringArg(args, "path") ?? "."), {
            ...(python ? { python } : {}),
            ...(openapi ? { openapi: path.resolve(openapi) } : {}),
            ...(coverage ? { coverage: path.resolve(coverage) } : {}),
            ...(configPath ? { configPath: path.resolve(configPath) } : {}),
            git,
            ...(maxGitCommits !== undefined ? { maxGitCommits } : {}),
            ...(!noCache && cacheDir ? { incrementalDir: path.resolve(cacheDir) } : {}),
          })
        ).report;

  ctx.agent = createAgentQueryContext(report, previous);
  ctx.seenPayloadHashes.clear();

  const reportPath = stringArg(args, "reportPath") ?? ctx.scanDefaults.reportPath;
  if (reportPath) writeJson(reportPath, report);
  if (baselinePath && boolArg(args, "updateBaseline")) writeJson(baselinePath, report);

  return {
    tool: "scan_project",
    plan: [
      "Run Code MRI scan through the existing engine pipeline",
      "Set scanned report as active MCP context",
      previous ? "Compute baseline diff from previous active report or baselinePath" : "No baseline diff available",
    ],
    confidence: "high",
    loc: null,
    activeReport: activeReportSummary(report),
    diff: ctx.agent.diff?.summary ?? null,
    message: `Scanned ${report.project.name}; active MCP report updated.`,
  };
}

async function loadReportTool(ctx: McpContext, args: Record<string, unknown>): Promise<unknown> {
  if (!ctx.allowScan) throw new Error("load_report requires starting MCP with --allow-scan");
  const reportPath = stringArg(args, "reportPath");
  if (!reportPath) throw new Error("load_report requires reportPath");
  const baselinePath = stringArg(args, "baselinePath");
  const report = readReport(reportPath);
  const baseline = baselinePath ? readReport(baselinePath) : undefined;
  ctx.agent = createAgentQueryContext(report, baseline);
  ctx.seenPayloadHashes.clear();
  return {
    tool: "load_report",
    plan: ["Read report JSON from disk", "Set report as active MCP context"],
    confidence: "high",
    loc: null,
    activeReport: activeReportSummary(report),
    diff: ctx.agent.diff?.summary ?? null,
    message: `Loaded ${report.project.name}; active MCP report updated.`,
  };
}

async function callTool(ctx: McpContext, name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === "scan_project") return scanProjectTool(ctx, args);
  if (name === "load_report") return loadReportTool(ctx, args);

  const agent = requireAgent(ctx);
  if (name === "impact_query") return impactQuery(agent, args);
  if (name === "graph_search") return graphSearch(agent, args as { query: string });
  if (name === "find_dead_code") return findDeadCode(agent, args);
  if (name === "check_breaking_changes") return checkBreakingChanges(agent, args);
  if (name === "get_node_context") return getNodeContext(agent, args);
  if (name === "ask_graph") return askGraph(agent, args as { question: string });
  if (name === "recommend_tests") return recommendTests(agent, args);
  if (name === "prepare_edit_context") return prepareEditContext(agent, args as { task: string });
  if (name === "read_windows") return readWindows(agent, args as { windows: never[] });
  if (name === "review_planned_change") return reviewPlannedChange(agent, args as { plan: string });
  if (name === "review_diff") return reviewDiff(agent, args);
  throw new Error(`Unknown Code MRI MCP tool: ${name}`);
}

export function createMcpContext(
  report?: Report,
  baseline?: Report,
  opts: { allowScan?: boolean; scanDefaults?: McpScanDefaults; textMode?: McpTextMode } = {},
): McpContext {
  return {
    ...(report ? { agent: createAgentQueryContext(report, baseline) } : {}),
    allowScan: opts.allowScan ?? false,
    scanDefaults: opts.scanDefaults ?? {},
    textMode: opts.textMode ?? "summary",
    seenPayloadHashes: new Set<string>(),
  };
}

export async function handleMcpRequest(
  ctx: McpContext,
  request: JsonRpcRequest,
): Promise<JsonRpcResponse | null> {
  if (request.method.startsWith("notifications/")) return null;

  try {
    if (request.method === "initialize") {
      return {
        jsonrpc: "2.0",
        id: request.id ?? null,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "code-mri", version: ENGINE_VERSION },
        },
      };
    }

    if (request.method === "ping") {
      return { jsonrpc: "2.0", id: request.id ?? null, result: {} };
    }

    if (request.method === "tools/list") {
      return {
        jsonrpc: "2.0",
        id: request.id ?? null,
        result: { tools: ctx.allowScan ? [...TOOL_SCHEMAS, ...MUTATING_TOOL_SCHEMAS] : TOOL_SCHEMAS },
      };
    }

    if (request.method === "tools/call") {
      const name = request.params?.name;
      if (typeof name !== "string") throw new Error("tools/call requires params.name");
      const result = await callTool(ctx, name, toolArguments(request.params));
      const structuredContent = isAgentToolResult(result)
        ? dedupeStructuredContent(
            ctx,
            result.resultStats ? result : finalizeAgentResult(result, toolArguments(request.params)),
          )
        : result;
      return {
        jsonrpc: "2.0",
        id: request.id ?? null,
        result: {
          content: [{ type: "text", text: contentText(structuredContent, ctx.textMode) }],
          structuredContent,
        },
      };
    }

    return {
      jsonrpc: "2.0",
      id: request.id ?? null,
      error: { code: -32601, message: `Unknown method: ${request.method}` },
    };
  } catch (error) {
    return {
      jsonrpc: "2.0",
      id: request.id ?? null,
      error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
    };
  }
}

function encodeMessage(message: JsonRpcResponse, contentLengthFraming: boolean): string {
  const body = JSON.stringify(message);
  // MCP stdio transport is newline-delimited JSON; Content-Length framing is
  // kept only for legacy LSP-style clients that send it first.
  return contentLengthFraming
    ? `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`
    : `${body}\n`;
}

export function startMcpServer(input: {
  report?: Report;
  baseline?: Report;
  allowScan?: boolean;
  scanDefaults?: McpScanDefaults;
  textMode?: McpTextMode;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
}): void {
  const ctx = createMcpContext(input.report, input.baseline, {
    allowScan: input.allowScan,
    scanDefaults: input.scanDefaults,
    textMode: input.textMode,
  });
  const stdin = input.stdin ?? process.stdin;
  const stdout = input.stdout ?? process.stdout;
  let buffer = "";
  let queue = Promise.resolve();
  let contentLengthFraming = false;

  function send(response: JsonRpcResponse | null): void {
    if (!response) return;
    stdout.write(encodeMessage(response, contentLengthFraming));
  }

  async function handleRaw(raw: string): Promise<void> {
    if (!raw.trim()) return;
    send(await handleMcpRequest(ctx, JSON.parse(raw) as JsonRpcRequest));
  }

  function enqueueRaw(raw: string): void {
    queue = queue
      .then(() => handleRaw(raw))
      .catch((error) => {
        send({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
        });
      });
  }

  stdin.on("data", (chunk) => {
    buffer += chunk.toString();
    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      const altHeaderEnd = buffer.indexOf("\n\n");
      const splitAt =
        headerEnd >= 0 ? headerEnd : altHeaderEnd >= 0 ? altHeaderEnd : -1;

      if (splitAt >= 0 && /^Content-Length:/i.test(buffer.slice(0, splitAt))) {
        contentLengthFraming = true;
        const header = buffer.slice(0, splitAt);
        const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
        if (!lengthMatch) throw new Error("Invalid MCP Content-Length header");
        const bodyStart = splitAt + (headerEnd >= 0 ? 4 : 2);
        const length = Number(lengthMatch[1]);
        if (buffer.length < bodyStart + length) return;
        const body = buffer.slice(bodyStart, bodyStart + length);
        buffer = buffer.slice(bodyStart + length);
        enqueueRaw(body);
        continue;
      }

      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      enqueueRaw(line);
    }
  });
}
