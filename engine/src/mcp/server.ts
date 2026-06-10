import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import type { ProjectRepoRole, Report } from "@code-mri/shared-types";
import {
  askGraph,
  checkBreakingChanges,
  createAgentQueryContext,
  findDeadCode,
  getNodeContext,
  graphSearch,
  impactQuery,
  recommendTests,
  type AgentQueryContext,
} from "../agent/index.js";
import { analyzeProject } from "../pipeline/analyze.js";
import { analyzeProjectRepos, type ProjectRepoInput } from "../pipeline/analyzeRepos.js";

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

const LOC_SCHEMA = {
  type: ["object", "null"],
  properties: {
    file: { type: "string" },
    line: { type: "number" },
    column: { type: "number" },
  },
};

const NODE_REF_SCHEMA = {
  type: "object",
  required: ["id", "kind", "name", "loc", "confidence", "evidence"],
  properties: {
    id: { type: "string" },
    kind: { type: "string" },
    name: { type: "string" },
    loc: LOC_SCHEMA,
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    evidence: { type: "array", items: { type: "string" } },
  },
};

const ISSUE_REF_SCHEMA = {
  type: "object",
  required: ["kind", "severity", "message", "nodes", "loc", "confidence", "evidence"],
  properties: {
    kind: { type: "string" },
    severity: { type: "string" },
    message: { type: "string" },
    nodes: { type: "array", items: NODE_REF_SCHEMA },
    loc: LOC_SCHEMA,
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    evidence: { type: "array", items: { type: "string" } },
  },
};

const EDGE_REF_SCHEMA = {
  type: "object",
  required: ["id", "kind", "from", "to", "confidence", "loc", "evidence"],
  properties: {
    id: { type: "string" },
    kind: { type: "string" },
    from: { ...NODE_REF_SCHEMA, type: ["object", "null"] },
    to: { ...NODE_REF_SCHEMA, type: ["object", "null"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    loc: LOC_SCHEMA,
    evidence: { type: "array", items: { type: "string" } },
  },
};

const TEST_COMMAND_SCHEMA = {
  type: "object",
  required: ["command", "reason", "confidence", "loc"],
  properties: {
    command: { type: "string" },
    reason: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    loc: LOC_SCHEMA,
  },
};

const AGENT_RESULT_REQUIRED = ["tool", "plan", "confidence", "loc", "message"];

const AGENT_RESULT_SCHEMA = {
  type: "object",
  required: AGENT_RESULT_REQUIRED,
  properties: {
    tool: { type: "string" },
    plan: { type: "array", items: { type: "string" } },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    loc: LOC_SCHEMA,
    nodes: { type: "array", items: NODE_REF_SCHEMA },
    candidates: { type: "array", items: NODE_REF_SCHEMA },
    edges: { type: "array", items: EDGE_REF_SCHEMA },
    issues: { type: "array", items: ISSUE_REF_SCHEMA },
    breakingChanges: { type: "array", items: ISSUE_REF_SCHEMA },
    testCommands: { type: "array", items: TEST_COMMAND_SCHEMA },
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
    activeReport: ACTIVE_REPORT_SCHEMA,
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
    inputSchema: { type: "object", properties: { limit: { type: "number" } } },
    outputSchema: AGENT_RESULT_SCHEMA,
  },
  {
    name: "get_node_context",
    description: "Return a node with incoming/outgoing edges and attached issues.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
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
        question: { type: "string" },
        limit: { type: "number" },
      },
    },
    outputSchema: {
      type: "object",
      required: [...AGENT_RESULT_REQUIRED, "result"],
      properties: {
        ...AGENT_RESULT_SCHEMA.properties,
        result: AGENT_RESULT_SCHEMA,
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
        nodeId: { type: "string" },
        query: { type: "string" },
        files: { type: "array", items: { type: "string" } },
        limit: { type: "number" },
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
}

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
  throw new Error(`Unknown Code MRI MCP tool: ${name}`);
}

export function createMcpContext(
  report?: Report,
  baseline?: Report,
  opts: { allowScan?: boolean; scanDefaults?: McpScanDefaults } = {},
): McpContext {
  return {
    ...(report ? { agent: createAgentQueryContext(report, baseline) } : {}),
    allowScan: opts.allowScan ?? false,
    scanDefaults: opts.scanDefaults ?? {},
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
          serverInfo: { name: "code-mri", version: "0.0.0" },
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
      return {
        jsonrpc: "2.0",
        id: request.id ?? null,
        result: {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
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

function encodeMessage(message: JsonRpcResponse): string {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}

export function startMcpServer(input: {
  report?: Report;
  baseline?: Report;
  allowScan?: boolean;
  scanDefaults?: McpScanDefaults;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
}): void {
  const ctx = createMcpContext(input.report, input.baseline, {
    allowScan: input.allowScan,
    scanDefaults: input.scanDefaults,
  });
  const stdin = input.stdin ?? process.stdin;
  const stdout = input.stdout ?? process.stdout;
  let buffer = "";
  let queue = Promise.resolve();

  function send(response: JsonRpcResponse | null): void {
    if (!response) return;
    stdout.write(encodeMessage(response));
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
