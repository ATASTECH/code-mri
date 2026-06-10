import type {
  BreakingChange,
  Confidence,
  EdgeKind,
  GraphEdge,
  GraphNode,
  Issue,
  IssueKind,
  NodeKind,
  Report,
  ReportDiff,
  SourceLocation,
} from "@code-mri/shared-types";
import { diffReports } from "../diff/reportDiff.js";
import { buildGraph } from "../graph/build.js";

export interface AgentNodeReference {
  id: string;
  kind: NodeKind;
  name: string;
  loc: SourceLocation | null;
  confidence: Confidence;
  evidence: string[];
}

export interface AgentEdgeReference {
  id: string;
  kind: EdgeKind;
  from: AgentNodeReference | null;
  to: AgentNodeReference | null;
  confidence: Confidence;
  loc: SourceLocation | null;
  evidence: string[];
}

export interface AgentIssueReference {
  kind: IssueKind;
  severity: Issue["severity"];
  message: string;
  nodes: AgentNodeReference[];
  loc: SourceLocation | null;
  confidence: Confidence;
  evidence: string[];
}

export interface AgentQueryContext {
  report: Report;
  baseline?: Report;
  diff?: ReportDiff;
}

export interface ImpactQueryInput {
  nodeId?: string;
  query?: string;
  limit?: number;
}

export interface GraphSearchInput {
  query: string;
  kinds?: NodeKind[];
  limit?: number;
}

export interface FindDeadCodeInput {
  confidence?: Confidence;
  limit?: number;
}

export interface CheckBreakingChangesInput {
  limit?: number;
}

export interface GetNodeContextInput {
  nodeId?: string;
  query?: string;
  limit?: number;
}

export interface AskGraphInput {
  question: string;
  limit?: number;
}

export interface RecommendTestsInput {
  nodeId?: string;
  query?: string;
  files?: string[];
  limit?: number;
}

export interface AgentTestCommand {
  command: string;
  reason: string;
  confidence: Confidence;
  loc: SourceLocation | null;
}

export interface AgentToolResult {
  tool: string;
  plan: string[];
  confidence: Confidence;
  loc: SourceLocation | null;
  nodes?: AgentNodeReference[];
  edges?: AgentEdgeReference[];
  issues?: AgentIssueReference[];
  breakingChanges?: AgentIssueReference[];
  candidates?: AgentNodeReference[];
  testCommands?: AgentTestCommand[];
  message?: string;
  result?: AgentToolResult;
}

function limitValue(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0) return fallback;
  return Math.min(100, Math.floor(value));
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function searchWords(value: string): string[] {
  return normalize(
    value
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_./:#-]+/g, " "),
  )
    .split(/\s+/)
    .filter(Boolean);
}

function scoreText(haystack: string, query: string): number {
  const q = normalize(query);
  if (!q) return 0;
  const h = normalize(haystack);
  if (h === q) return 100;
  if (h.endsWith(q)) return 80;
  if (h.includes(q)) return 60;

  const queryWords = searchWords(query);
  if (queryWords.length === 0) return 0;
  const haystackWords = searchWords(haystack);
  const queryPhrase = queryWords.join(" ");
  const haystackPhrase = haystackWords.join(" ");
  const queryCompact = queryWords.join("");
  const haystackCompact = haystackWords.join("");

  if (haystackPhrase === queryPhrase || haystackCompact === queryCompact) return 100;
  if (haystackPhrase.endsWith(queryPhrase) || haystackCompact.endsWith(queryCompact)) return 80;
  if (haystackPhrase.includes(queryPhrase) || haystackCompact.includes(queryCompact)) return 60;
  if (queryWords.every((word) => haystackWords.includes(word))) return 60;
  return 0;
}

function nodeLoc(node: GraphNode | undefined): SourceLocation | null {
  return node?.loc ?? null;
}

export function nodeReference(
  node: GraphNode,
  confidence: Confidence = "high",
  evidence: string[] = [],
): AgentNodeReference {
  return {
    id: node.id,
    kind: node.kind,
    name: node.name,
    loc: node.loc ?? null,
    confidence,
    evidence: evidence.length ? evidence : [`Matched ${node.kind} "${node.name}"`],
  };
}

function edgeReference(edge: GraphEdge, nodes: Map<string, GraphNode>): AgentEdgeReference {
  const from = nodes.get(edge.from);
  const to = nodes.get(edge.to);
  return {
    id: edge.id,
    kind: edge.kind,
    from: from ? nodeReference(from) : null,
    to: to ? nodeReference(to) : null,
    confidence: edge.confidence ?? "high",
    loc: nodeLoc(from) ?? nodeLoc(to),
    evidence: [`${edge.kind} edge ${edge.from} -> ${edge.to}`],
  };
}

function issueReference(issue: Issue, nodes: Map<string, GraphNode>): AgentIssueReference {
  const refs = issue.nodes
    .map((id) => nodes.get(id))
    .filter((node): node is GraphNode => Boolean(node))
    .map((node) => nodeReference(node));
  return {
    kind: issue.kind,
    severity: issue.severity,
    message: issue.message,
    nodes: refs,
    loc: refs.find((node) => node.loc)?.loc ?? null,
    confidence: issue.candidate ? "medium" : "high",
    evidence: [`Issue emitted by deterministic rule ${issue.kind}`],
  };
}

function breakingReference(
  change: BreakingChange,
  nodes: Map<string, GraphNode>,
): AgentIssueReference {
  const refs = change.nodes
    .map((id) => nodes.get(id))
    .filter((node): node is GraphNode => Boolean(node))
    .map((node) => nodeReference(node));
  return {
    kind: change.kind,
    severity: change.severity,
    message: change.message,
    nodes: refs,
    loc: refs.find((node) => node.loc)?.loc ?? null,
    confidence: "high",
    evidence: ["Detected by deterministic report diff"],
  };
}

function nodesById(report: Report): Map<string, GraphNode> {
  return new Map(report.nodes.map((node) => [node.id, node]));
}

function scoreNode(node: GraphNode, query: string): number {
  const file = node.loc?.file ?? "";
  return Math.max(...[node.id, node.name, file].map((item) => scoreText(item, query)));
}

function findBestNode(report: Report, input: { nodeId?: string; query?: string }): {
  node: GraphNode | null;
  confidence: Confidence;
  candidates: GraphNode[];
} {
  const byId = nodesById(report);
  if (input.nodeId) {
    const node = byId.get(input.nodeId);
    return { node: node ?? null, confidence: node ? "high" : "low", candidates: node ? [node] : [] };
  }

  if (!input.query) return { node: null, confidence: "low", candidates: [] };
  const scored = report.nodes
    .map((node) => ({ node, score: scoreNode(node, input.query as string) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id));
  const first = scored[0]?.node ?? null;
  const confidence: Confidence = scored[0]?.score === 100 ? "high" : scored[0]?.score === 80 ? "medium" : "low";
  return { node: first, confidence, candidates: scored.map((item) => item.node).slice(0, 10) };
}

export function createAgentQueryContext(report: Report, baseline?: Report): AgentQueryContext {
  return {
    report,
    ...(baseline ? { baseline, diff: diffReports(baseline, report) } : {}),
  };
}

function sortByLoc(a: GraphNode, b: GraphNode): number {
  const file = (a.loc?.file ?? "").localeCompare(b.loc?.file ?? "");
  if (file !== 0) return file;
  return (a.loc?.line ?? 0) - (b.loc?.line ?? 0) || a.id.localeCompare(b.id);
}

function uniqueNodes(nodes: GraphNode[]): GraphNode[] {
  const seen = new Set<string>();
  const out: GraphNode[] = [];
  for (const node of nodes) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    out.push(node);
  }
  return out;
}

function filePathForNode(node: GraphNode): string | null {
  if (node.loc?.file) return node.loc.file;
  return node.kind === "File" ? node.name : null;
}

function nodesInFile(report: Report, file: string): GraphNode[] {
  return report.nodes
    .filter((node) => node.kind !== "File" && node.loc?.file === file)
    .sort(sortByLoc);
}

function importedByFiles(report: Report, fileId: string, byId: Map<string, GraphNode>): GraphNode[] {
  return report.edges
    .filter((edge) => edge.kind === "IMPORTS" && edge.to === fileId)
    .map((edge) => byId.get(edge.from))
    .filter((node): node is GraphNode => Boolean(node))
    .sort(sortByLoc);
}

export function graphSearch(ctx: AgentQueryContext, input: GraphSearchInput): AgentToolResult {
  const limit = limitValue(input.limit, 20);
  const kinds = input.kinds ? new Set<NodeKind>(input.kinds) : null;
  const nodes = ctx.report.nodes
    .map((node) => ({ node, score: scoreNode(node, input.query) }))
    .filter((item) => item.score > 0 && (!kinds || kinds.has(item.node.kind)))
    .sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id))
    .slice(0, limit)
    .map((item) =>
      nodeReference(
        item.node,
        item.score >= 100 ? "high" : item.score >= 80 ? "medium" : "low",
        [`Search matched "${input.query}" with score ${item.score}`],
      ),
    );

  return {
    tool: "graph_search",
    plan: ["Search report nodes by id, name, and source file", "Return deterministic ranked matches"],
    confidence: nodes.length ? nodes[0]!.confidence : "low",
    loc: nodes.find((node) => node.loc)?.loc ?? null,
    nodes,
    message: nodes.length ? `Found ${nodes.length} node(s).` : "No graph nodes matched.",
  };
}

export function impactQuery(ctx: AgentQueryContext, input: ImpactQueryInput): AgentToolResult {
  const limit = limitValue(input.limit, 25);
  const match = findBestNode(ctx.report, input);
  if (!match.node) {
    return {
      tool: "impact_query",
      plan: ["Resolve the requested node", "No impact traversal runs without a node"],
      confidence: "low",
      loc: null,
      candidates: match.candidates.map((node) => nodeReference(node, "low")),
      message: "No matching node found for impact query.",
    };
  }

  const graph = buildGraph({ nodes: ctx.report.nodes, edges: ctx.report.edges });
  const byId = nodesById(ctx.report);
  const file = filePathForNode(match.node);
  const expanded = match.node.kind === "File" && file ? nodesInFile(ctx.report, file) : [];
  const sourceNodes = uniqueNodes([match.node, ...expanded]);
  const candidates = new Map<string, { node: GraphNode; evidence: string[] }>();

  function addCandidate(node: GraphNode, evidence: string): void {
    if (node.id === match.node!.id) return;
    const existing = candidates.get(node.id);
    if (existing) existing.evidence.push(evidence);
    else candidates.set(node.id, { node, evidence: [evidence] });
  }

  if (match.node.kind === "File") {
    for (const node of importedByFiles(ctx.report, match.node.id, byId)) {
      addCandidate(node, `File imports ${match.node.id}`);
    }
  }

  const traversalSources = match.node.kind === "File" ? expanded : [match.node];
  for (const source of traversalSources) {
    for (const node of graph.impact(source.id)) {
      addCandidate(node, `Impacted through graph traversal from ${source.id}`);
    }
  }

  const impacted = [...candidates.values()]
    .map(({ node, evidence }) => nodeReference(node, "high", [...new Set(evidence)].slice(0, 3)))
    .slice(0, limit);
  const sourceRefs = sourceNodes
    .slice(0, Math.min(10, Math.max(1, limit)))
    .map((node, index) =>
      nodeReference(
        node,
        index === 0 ? match.confidence : "medium",
        index === 0
          ? [`Matched ${node.kind} "${node.name}"`]
          : [`Expanded from file ${file}`],
      ),
    );
  const expandedPlan =
    match.node.kind === "File"
      ? [
          "Expand the file node to contained symbols",
          "Include files that import the changed file",
        ]
      : [];

  return {
    tool: "impact_query",
    plan: [
      "Resolve the source node from nodeId or query",
      ...expandedPlan,
      "Run graph impact traversal over the existing report graph",
      "Return transitive dependent nodes with source locations",
    ],
    confidence: match.confidence,
    loc: match.node.loc ?? null,
    nodes: sourceRefs,
    candidates: impacted,
    message:
      match.node.kind === "File"
        ? `Changing ${match.node.id} expands to ${expanded.length} symbol(s) and impacts ${impacted.length} node(s) in the returned window.`
        : `Changing ${match.node.id} impacts ${impacted.length} node(s) in the returned window.`,
  };
}

export function findDeadCode(ctx: AgentQueryContext, input: FindDeadCodeInput = {}): AgentToolResult {
  const limit = limitValue(input.limit, 50);
  const nodes = nodesById(ctx.report);
  const issues = ctx.report.issues
    .filter((issue) => issue.kind === "DEAD_CODE" || issue.kind === "UNUSED_ENDPOINT")
    .map((issue) => issueReference(issue, nodes))
    .filter((issue) => !input.confidence || issue.confidence === input.confidence)
    .slice(0, limit);

  return {
    tool: "find_dead_code",
    plan: ["Read existing DEAD_CODE and UNUSED_ENDPOINT issues from the report"],
    confidence: issues.length ? "medium" : "high",
    loc: issues.find((issue) => issue.loc)?.loc ?? null,
    issues,
    message: issues.length ? `Found ${issues.length} dead-code candidate(s).` : "No dead-code candidates found.",
  };
}

export function checkBreakingChanges(
  ctx: AgentQueryContext,
  input: CheckBreakingChangesInput = {},
): AgentToolResult {
  const limit = limitValue(input.limit, 50);
  const nodes = nodesById(ctx.report);
  for (const node of ctx.baseline?.nodes ?? []) {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  }
  const currentBreaking = ctx.report.issues
    .filter((issue) => issue.kind.startsWith("BREAKING_"))
    .map((issue) => issueReference(issue, nodes));
  const diffBreaking = (ctx.diff?.breakingChanges ?? []).map((change) =>
    breakingReference(change, nodes),
  );
  const breakingChanges = [...diffBreaking, ...currentBreaking].slice(0, limit);

  return {
    tool: "check_breaking_changes",
    plan: ctx.diff
      ? ["Compare baseline report to current report", "Return deterministic breaking changes"]
      : ["Read current report BREAKING_* issues", "No baseline diff was provided"],
    confidence: ctx.diff ? "high" : "medium",
    loc: breakingChanges.find((issue) => issue.loc)?.loc ?? null,
    breakingChanges,
    message: ctx.diff
      ? `Found ${breakingChanges.length} breaking change(s) with baseline diff.`
      : `Found ${breakingChanges.length} current BREAKING_* issue(s); baseline diff unavailable.`,
  };
}

export function getNodeContext(ctx: AgentQueryContext, input: GetNodeContextInput): AgentToolResult {
  const limit = limitValue(input.limit, 30);
  const match = findBestNode(ctx.report, input);
  if (!match.node) {
    return {
      tool: "get_node_context",
      plan: ["Resolve requested node", "No context can be returned without a node"],
      confidence: "low",
      loc: null,
      candidates: match.candidates.map((node) => nodeReference(node, "low")),
      message: "No matching node found for context query.",
    };
  }

  const graph = buildGraph({ nodes: ctx.report.nodes, edges: ctx.report.edges });
  const byId = nodesById(ctx.report);
  const file = filePathForNode(match.node);
  const expanded = match.node.kind === "File" && file ? nodesInFile(ctx.report, file) : [];
  const contextNodes = uniqueNodes([match.node, ...expanded]);
  const contextIds = new Set(contextNodes.map((node) => node.id));
  const edgeMap = new Map<string, GraphEdge>();
  for (const node of contextNodes) {
    for (const edge of [...graph.inEdges(node.id), ...graph.outEdges(node.id)]) {
      edgeMap.set(edge.id, edge);
    }
  }
  const edges = [...edgeMap.values()]
    .slice(0, limit)
    .map((edge) => edgeReference(edge, byId));
  const issues = ctx.report.issues
    .filter((issue) => issue.nodes.some((id) => contextIds.has(id)))
    .slice(0, limit)
    .map((issue) => issueReference(issue, byId));

  return {
    tool: "get_node_context",
    plan: [
      "Resolve node",
      ...(match.node.kind === "File" ? ["Expand the file node to contained symbols"] : []),
      "Collect incoming/outgoing graph edges",
      "Collect directly attached issues",
    ],
    confidence: match.confidence,
    loc: match.node.loc ?? null,
    nodes: contextNodes.slice(0, limit).map((node, index) =>
      nodeReference(
        node,
        index === 0 ? match.confidence : "medium",
        index === 0 ? [] : [`Expanded from file ${file}`],
      ),
    ),
    edges,
    issues,
    message:
      match.node.kind === "File"
        ? `Context for ${match.node.id}: ${expanded.length} symbol(s), ${edges.length} edge(s), ${issues.length} issue(s).`
        : `Context for ${match.node.id}: ${edges.length} edge(s), ${issues.length} issue(s).`,
  };
}

function normalizeReportPath(value: string, root?: string): string {
  let file = value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  const normalizedRoot = root?.replace(/\\/g, "/").replace(/\/+$/g, "");
  if (normalizedRoot && file.startsWith(`${normalizedRoot}/`)) {
    file = file.slice(normalizedRoot.length + 1);
  }
  return file;
}

function allReportFiles(report: Report): string[] {
  const files = new Set<string>();
  for (const node of report.nodes) {
    const file = filePathForNode(node);
    if (file) files.add(file);
  }
  return [...files].sort();
}

function basenameWithoutExtension(file: string): string {
  const name = file.slice(file.lastIndexOf("/") + 1);
  return name.replace(/\.[^.]+$/g, "");
}

function dirname(file: string): string {
  const slash = file.lastIndexOf("/");
  return slash === -1 ? "" : file.slice(0, slash);
}

function isTestFile(file: string): boolean {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
}

function nearbyTestFiles(files: string[], changedFile: string): string[] {
  if (isTestFile(changedFile)) return files.includes(changedFile) ? [changedFile] : [];

  const dir = dirname(changedFile);
  const base = basenameWithoutExtension(changedFile);
  const exact = new Set([
    `${dir}/${base}.test.ts`,
    `${dir}/${base}.test.tsx`,
    `${dir}/${base}.spec.ts`,
    `${dir}/${base}.spec.tsx`,
  ].map((item) => item.replace(/^\//, "")));

  const matches = files.filter((file) => {
    if (!isTestFile(file)) return false;
    if (exact.has(file)) return true;
    const testBase = basenameWithoutExtension(file).replace(/\.(test|spec)$/g, "");
    return testBase === base && file.startsWith(`${dir}/`);
  });
  return [...new Set(matches)].sort();
}

function packageNameForFile(file: string): "engine" | "desktop" | "shared-types" | "workspace" {
  if (file.startsWith("engine/")) return "engine";
  if (file.startsWith("apps/desktop/")) return "desktop";
  if (file.startsWith("packages/shared-types/")) return "shared-types";
  return "workspace";
}

function stripPackagePrefix(file: string): string {
  return file
    .replace(/^engine\//, "")
    .replace(/^apps\/desktop\//, "")
    .replace(/^packages\/shared-types\//, "");
}

function filesFromRecommendInput(ctx: AgentQueryContext, input: RecommendTestsInput): string[] {
  const files = new Set<string>();
  for (const file of input.files ?? []) {
    const normalized = normalizeReportPath(file, ctx.report.project.root);
    if (normalized) files.add(normalized);
  }

  if (input.nodeId || input.query) {
    const match = findBestNode(ctx.report, input);
    if (match.node) {
      const file = filePathForNode(match.node);
      if (file) files.add(file);
    } else if (input.query) {
      const token = lastPathLikeToken(input.query) ?? input.query;
      const normalized = normalizeReportPath(token, ctx.report.project.root);
      if (normalized.includes("/")) files.add(normalized);
    }
  }

  return [...files].sort();
}

function commandLocation(ctx: AgentQueryContext, file: string): SourceLocation | null {
  const node = ctx.report.nodes.find((item) => filePathForNode(item) === file);
  return node?.loc ?? { file };
}

function uniqueCommands(commands: AgentTestCommand[]): AgentTestCommand[] {
  const seen = new Set<string>();
  const out: AgentTestCommand[] = [];
  for (const command of commands) {
    if (seen.has(command.command)) continue;
    seen.add(command.command);
    out.push(command);
  }
  return out;
}

export function recommendTests(
  ctx: AgentQueryContext,
  input: RecommendTestsInput = {},
): AgentToolResult {
  const limit = limitValue(input.limit, 12);
  const files = filesFromRecommendInput(ctx, input);
  const reportFiles = allReportFiles(ctx.report);
  const commands: AgentTestCommand[] = [];

  function add(command: string, reason: string, confidence: Confidence, loc: SourceLocation | null): void {
    commands.push({ command, reason, confidence, loc });
  }

  for (const file of files) {
    const pkg = packageNameForFile(file);
    const loc = commandLocation(ctx, file);
    const tests = nearbyTestFiles(reportFiles, file).map(stripPackagePrefix);

    if (pkg === "engine") {
      if (tests.length > 0) {
        add(
          `pnpm --filter @code-mri/engine test -- ${tests.join(" ")}`,
          `Nearest engine test file(s) for ${file}`,
          "high",
          loc,
        );
      } else {
        add("pnpm --filter @code-mri/engine test", `No direct test file was found for ${file}`, "medium", loc);
      }
      add("pnpm --filter @code-mri/engine typecheck", "Engine TypeScript API changed or may be consumed by the CLI", "high", loc);
      if (/^engine\/src\/(agent|mcp|cli|index\.ts)/.test(file)) {
        add("pnpm --filter @code-mri/engine build", "Public engine or CLI/MCP surface changed", "high", loc);
      }
    } else if (pkg === "desktop") {
      if (tests.length > 0) {
        add(
          `pnpm --filter @code-mri/desktop test -- ${tests.join(" ")}`,
          `Nearest desktop test file(s) for ${file}`,
          "high",
          loc,
        );
      } else {
        add("pnpm --filter @code-mri/desktop test", `No direct desktop test file was found for ${file}`, "medium", loc);
      }
      add("pnpm --filter @code-mri/desktop typecheck", "Desktop TypeScript surface changed", "high", loc);
    } else if (pkg === "shared-types") {
      add("pnpm --filter @code-mri/shared-types build", "Shared report/type contract changed", "high", loc);
      add("pnpm --filter @code-mri/engine typecheck", "Engine consumes shared-types", "high", loc);
      add("pnpm --filter @code-mri/desktop typecheck", "Desktop consumes shared-types", "medium", loc);
    } else {
      add("pnpm test", `Workspace-level fallback for ${file}`, "low", loc);
    }
  }

  if (files.length === 0) {
    add("pnpm --filter @code-mri/engine test", "No changed file could be resolved; run the core engine suite", "low", null);
    add("pnpm --filter @code-mri/engine typecheck", "No changed file could be resolved; verify engine types", "low", null);
  }
  add("git diff --check", "Catch whitespace/conflict-marker issues before handoff", "medium", files[0] ? { file: files[0] } : null);

  const testCommands = uniqueCommands(commands).slice(0, limit);
  return {
    tool: "recommend_tests",
    plan: [
      "Resolve changed files from nodeId, query, or explicit files",
      "Find nearby test files from the active report",
      "Add package-level typecheck/build commands for changed surfaces",
    ],
    confidence: files.length ? "high" : "low",
    loc: files[0] ? { file: files[0] } : null,
    testCommands,
    message: `Recommended ${testCommands.length} verification command(s) for ${files.length || "unknown"} file(s).`,
  };
}

function extractQuoted(value: string): string | null {
  const quoted = value.match(/["'`](.+?)["'`]/);
  if (quoted?.[1]) return quoted[1];
  return null;
}

function lastPathLikeToken(value: string): string | null {
  const tokens = value.split(/\s+/).map((token) => token.replace(/[?,.;:]+$/g, ""));
  return [...tokens].reverse().find((token) => token.includes("/") || token.includes("#") || token.includes(".")) ?? null;
}

export function planGraphQuestion(input: AskGraphInput): {
  tool:
    | "impact_query"
    | "graph_search"
    | "find_dead_code"
    | "check_breaking_changes"
    | "get_node_context"
    | "recommend_tests";
  arguments: Record<string, unknown>;
  rationale: string;
  confidence: Confidence;
} {
  const q = normalize(input.question);
  const query = extractQuoted(input.question) ?? lastPathLikeToken(input.question) ?? input.question;
  const limit = input.limit;

  if (/(breaking|break|kır|kir|what changed|diff|regression)/.test(q)) {
    return {
      tool: "check_breaking_changes",
      arguments: { limit },
      rationale: "Question asks for breaking changes or diff risk.",
      confidence: "high",
    };
  }
  if (/(impact|affect|blast|etkilen|etkiler|değiş|degis|change)/.test(q)) {
    return {
      tool: "impact_query",
      arguments: { query, limit },
      rationale: "Question asks what would be affected by a change.",
      confidence: "medium",
    };
  }
  if (/(dead|unused|ölü|olu|kullanılmayan|kullanilmayan)/.test(q)) {
    return {
      tool: "find_dead_code",
      arguments: { limit },
      rationale: "Question asks for unused/dead code candidates.",
      confidence: "high",
    };
  }
  if (/(test|verify|verification|doğrula|dogrula|koş|kos|hangi komut|command)/.test(q)) {
    return {
      tool: "recommend_tests",
      arguments: { query, limit },
      rationale: "Question asks which verification commands should run.",
      confidence: "high",
    };
  }
  if (/(context|detail|detay|neden|why|node)/.test(q)) {
    return {
      tool: "get_node_context",
      arguments: { query, limit },
      rationale: "Question asks for context around a graph node.",
      confidence: "medium",
    };
  }

  return {
    tool: "graph_search",
    arguments: { query, limit },
    rationale: "Question is a general graph lookup.",
    confidence: "medium",
  };
}

export function askGraph(ctx: AgentQueryContext, input: AskGraphInput): AgentToolResult {
  const plan = planGraphQuestion(input);
  const result =
    plan.tool === "impact_query"
      ? impactQuery(ctx, plan.arguments as ImpactQueryInput)
      : plan.tool === "find_dead_code"
        ? findDeadCode(ctx, plan.arguments as FindDeadCodeInput)
        : plan.tool === "check_breaking_changes"
          ? checkBreakingChanges(ctx, plan.arguments as CheckBreakingChangesInput)
          : plan.tool === "recommend_tests"
            ? recommendTests(ctx, plan.arguments as RecommendTestsInput)
            : plan.tool === "get_node_context"
              ? getNodeContext(ctx, plan.arguments as GetNodeContextInput)
              : graphSearch(ctx, plan.arguments as unknown as GraphSearchInput);

  return {
    tool: "ask_graph",
    plan: [
      "Classify the natural-language question with deterministic keyword rules",
      `Selected ${plan.tool}: ${plan.rationale}`,
      ...result.plan,
    ],
    confidence: plan.confidence,
    loc: result.loc,
    result,
    message: `Ask graph routed to ${plan.tool}.`,
  };
}
