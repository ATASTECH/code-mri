import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import * as path from "node:path";
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
} from "../types.js";
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

export type AgentDetail = "brief" | "standard" | "full";

export interface AgentContextInput {
  detail?: AgentDetail;
  tokenBudget?: number;
  depth?: number;
  includeEvidence?: boolean;
  cursor?: string;
}

export interface ImpactQueryInput extends AgentContextInput {
  nodeId?: string;
  query?: string;
  limit?: number;
}

export interface GraphSearchInput extends AgentContextInput {
  query: string;
  kinds?: NodeKind[];
  limit?: number;
}

export interface FindDeadCodeInput extends AgentContextInput {
  confidence?: Confidence;
  limit?: number;
}

export interface CheckBreakingChangesInput extends AgentContextInput {
  limit?: number;
}

export interface GetNodeContextInput extends AgentContextInput {
  nodeId?: string;
  query?: string;
  limit?: number;
}

export interface AskGraphInput extends AgentContextInput {
  question: string;
  limit?: number;
}

export interface RecommendTestsInput extends AgentContextInput {
  nodeId?: string;
  query?: string;
  files?: string[];
  limit?: number;
}

export interface PrepareEditContextInput extends AgentContextInput {
  task: string;
  files?: string[];
  nodeIds?: string[];
  maxFiles?: number;
  maxWindows?: number;
}

export type AgentReasonCode =
  | "direct-match"
  | "caller"
  | "callee"
  | "breaking-risk"
  | "hotspot"
  | "coverage-gap"
  | "test-file";

export interface AgentLineWindow {
  file: string;
  startLine: number;
  endLine: number;
  reasonCode?: AgentReasonCode;
  reason: string;
  confidence: Confidence;
}

export interface ReadWindowsInput extends AgentContextInput {
  windows: AgentLineWindow[];
  mode?: "source" | "locations" | "outline";
  includeSource?: boolean;
  includeSensitive?: boolean;
  maxWindows?: number;
  maxLines?: number;
  maxChars?: number;
}

export interface AgentSourceWindow extends AgentLineWindow {
  source?: string;
  sha1?: string;
  redacted?: boolean;
  omitted?: boolean;
  message?: string;
}

export interface ReviewPlannedChangeInput extends AgentContextInput {
  plan: string;
  files?: string[];
  nodeIds?: string[];
}

export interface ReviewDiffInput extends AgentContextInput {
  diffText?: string;
  files?: string[];
}

export interface TokenSavingsReportInput extends AgentContextInput {
  windows?: AgentLineWindow[];
  files?: string[];
}

export interface AgentTestCommand {
  command: string;
  reason: string;
  confidence: Confidence;
  loc: SourceLocation | null;
}

export interface AgentResultStats {
  detail: AgentDetail;
  returned: Record<string, number>;
  omitted: Record<string, number>;
  responseBytes: number;
  estimatedTokens: number;
  budgetTokens?: number;
  nextCursor?: string;
}

export interface AgentNextQuery {
  tool: string;
  arguments: Record<string, unknown>;
  reason: string;
}

export interface AgentTokenSavings {
  estimatedFullFileBytes: number;
  returnedWindowBytes: number;
  avoidedBytes: number;
  estimatedTokensAvoided: number;
  filesConsidered: number;
  windowsConsidered: number;
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
  mustRead?: AgentLineWindow[];
  maybeReadLater?: AgentLineWindow[];
  impacts?: AgentNodeReference[];
  risks?: AgentIssueReference[];
  testPlan?: AgentTestCommand[];
  nextSteps?: string[];
  windows?: AgentSourceWindow[];
  mustFix?: string[];
  shouldCheck?: string[];
  safeToProceed?: boolean;
  verificationCommands?: AgentTestCommand[];
  tokenSavings?: AgentTokenSavings;
  resultStats?: AgentResultStats;
  nextQueries?: AgentNextQuery[];
  message?: string;
  result?: AgentToolResult;
}

function limitValue(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0) return fallback;
  return Math.min(100, Math.floor(value));
}

function maxValue(value: number | undefined, fallback: number, cap: number): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0) return fallback;
  return Math.min(cap, Math.floor(value));
}

function detailValue(value: AgentDetail | undefined): AgentDetail {
  return value === "standard" || value === "full" ? value : "brief";
}

function optionLimit(input: AgentContextInput | undefined, fallback: number): number {
  const detail = detailValue(input?.detail);
  const detailLimit = detail === "full" ? fallback : detail === "standard" ? Math.min(fallback, 25) : Math.min(fallback, 8);
  const budgetLimit =
    input?.tokenBudget && input.tokenBudget > 0
      ? Math.max(3, Math.min(detailLimit, Math.floor(input.tokenBudget / 250)))
      : detailLimit;
  return limitValue((input as { limit?: number } | undefined)?.limit, budgetLimit);
}

function evidenceLimit(input: AgentContextInput | undefined): number {
  if (input?.includeEvidence === false) return 0;
  if (input?.includeEvidence === true) return detailValue(input.detail) === "full" ? 5 : 2;
  return detailValue(input?.detail) === "full" ? 3 : detailValue(input?.detail) === "standard" ? 1 : 0;
}

function compactNodeReference(node: AgentNodeReference, maxEvidence: number): AgentNodeReference {
  return {
    ...node,
    evidence: maxEvidence > 0 ? node.evidence.slice(0, maxEvidence) : [],
  };
}

function compactIssueReference(issue: AgentIssueReference, maxEvidence: number): AgentIssueReference {
  return {
    ...issue,
    nodes: issue.nodes.map((node) => compactNodeReference(node, maxEvidence)),
    evidence: maxEvidence > 0 ? issue.evidence.slice(0, maxEvidence) : [],
  };
}

function compactEdgeReference(edge: AgentEdgeReference, maxEvidence: number): AgentEdgeReference {
  return {
    ...edge,
    from: edge.from ? compactNodeReference(edge.from, maxEvidence) : null,
    to: edge.to ? compactNodeReference(edge.to, maxEvidence) : null,
    evidence: maxEvidence > 0 ? edge.evidence.slice(0, maxEvidence) : [],
  };
}

const ARRAY_RESULT_KEYS = [
  "nodes",
  "edges",
  "issues",
  "breakingChanges",
  "candidates",
  "testCommands",
  "mustRead",
  "maybeReadLater",
  "impacts",
  "risks",
  "testPlan",
  "nextSteps",
  "windows",
  "mustFix",
  "shouldCheck",
  "verificationCommands",
] as const;

type ArrayResultKey = (typeof ARRAY_RESULT_KEYS)[number];

function arrayBudget(key: ArrayResultKey, input: AgentContextInput | undefined): number {
  const detail = detailValue(input?.detail);
  const base =
    key === "edges" || key === "issues" || key === "breakingChanges" || key === "candidates" || key === "impacts"
      ? 30
      : key === "windows" || key === "mustRead" || key === "maybeReadLater"
        ? 12
        : 20;
  return optionLimit(input, detail === "full" ? base : detail === "standard" ? Math.min(base, 16) : Math.min(base, 8));
}

function estimateTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

function resultTokens(result: AgentToolResult): number {
  return estimateTokens(JSON.stringify({ ...result, resultStats: undefined }));
}

function parseCursor(value: string | undefined): { key: ArrayResultKey; offset: number } | null {
  if (!value) return null;
  const match = value.match(/^([A-Za-z]+):(\d+)$/);
  if (!match) return null;
  const key = match[1] as ArrayResultKey;
  if (!(ARRAY_RESULT_KEYS as readonly string[]).includes(key)) return null;
  return { key, offset: Number(match[2]) };
}

export function finalizeAgentResult(result: AgentToolResult, input: AgentContextInput = {}): AgentToolResult {
  const maxEvidence = evidenceLimit(input);
  const out: AgentToolResult = { ...result };
  const returned: Record<string, number> = {};
  const omitted: Record<string, number> = {};
  const pageStarts: Record<string, number> = {};
  const cursor = parseCursor(input.cursor);

  if (out.nodes) out.nodes = out.nodes.map((node) => compactNodeReference(node, maxEvidence));
  if (out.candidates) out.candidates = out.candidates.map((node) => compactNodeReference(node, maxEvidence));
  if (out.impacts) out.impacts = out.impacts.map((node) => compactNodeReference(node, maxEvidence));
  if (out.edges) out.edges = out.edges.map((edge) => compactEdgeReference(edge, maxEvidence));
  if (out.issues) out.issues = out.issues.map((issue) => compactIssueReference(issue, maxEvidence));
  if (out.breakingChanges) {
    out.breakingChanges = out.breakingChanges.map((issue) => compactIssueReference(issue, maxEvidence));
  }
  if (out.risks) out.risks = out.risks.map((issue) => compactIssueReference(issue, maxEvidence));
  if (out.result && !out.result.resultStats) out.result = finalizeAgentResult(out.result, input);

  for (const key of ARRAY_RESULT_KEYS) {
    const value = out[key];
    if (!Array.isArray(value)) continue;
    const budget = arrayBudget(key, input);
    const start = cursor?.key === key ? Math.min(cursor.offset, value.length) : 0;
    const page = value.slice(start, start + budget);
    pageStarts[key] = start;
    returned[key] = page.length;
    omitted[key] = Math.max(0, value.length - start - page.length);
    (out as unknown as Record<ArrayResultKey, unknown[]>)[key] = page;
  }

  const nextQueries = [...(out.nextQueries ?? [])];
  for (const [key, count] of Object.entries(omitted)) {
    if (count > 0) {
      nextQueries.push({
        tool: out.tool,
        arguments: nextQueryArguments(input, key, `${key}:${(pageStarts[key] ?? 0) + (returned[key] ?? 0)}`, count),
        reason: `${count} ${key} item(s) omitted by the current result budget.`,
      });
    }
  }
  if (out.result?.nextQueries?.length) nextQueries.push(...out.result.nextQueries.slice(0, 2));
  if (nextQueries.length) out.nextQueries = nextQueries.slice(0, 3);

  const budgetTokens = input.tokenBudget && input.tokenBudget > 0 ? Math.floor(input.tokenBudget) : undefined;
  if (budgetTokens) enforceTokenBudget(out, returned, omitted, budgetTokens);

  const nextCursorEntry = Object.entries(omitted).find(([, count]) => count > 0);
  const nextCursor = nextCursorEntry
    ? `${nextCursorEntry[0]}:${(pageStarts[nextCursorEntry[0]] ?? 0) + (returned[nextCursorEntry[0]] ?? 0)}`
    : out.result?.resultStats?.nextCursor;
  const json = JSON.stringify({ ...out, resultStats: undefined });
  out.resultStats = {
    detail: detailValue(input.detail),
    returned,
    omitted,
    responseBytes: Buffer.byteLength(json, "utf8"),
    estimatedTokens: estimateTokens(json),
    ...(budgetTokens ? { budgetTokens } : {}),
    ...(nextCursor ? { nextCursor } : {}),
  };
  return out;
}

function nextQueryArguments(input: AgentContextInput, key: string, cursor: string, omittedCount: number): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const [argKey, value] of Object.entries(input as Record<string, unknown>)) {
    if (value !== undefined) args[argKey] = value;
  }
  args.cursor = cursor;
  args.detail = args.detail ?? "standard";
  args.limit = Math.min(omittedCount, 20);
  if (key !== "windows") delete args.maxChars;
  // Unconditional cap: suggestions must never echo large input arrays
  // (e.g. read_windows' windows list) back into the response.
  if (JSON.stringify(args).length > 400) {
    return { cursor: args.cursor, detail: args.detail, limit: args.limit };
  }
  return args;
}

function enforceTokenBudget(
  result: AgentToolResult,
  returned: Record<string, number>,
  omitted: Record<string, number>,
  budgetTokens: number,
): void {
  for (let attempts = 0; attempts < 80 && resultTokens(result) > budgetTokens; attempts += 1) {
    if (trimWindowSource(result)) continue;
    if (trimLargestArray(result, returned, omitted)) continue;
    if (trimNextQueries(result)) continue;
    break;
  }
}

function trimNextQueries(result: AgentToolResult): boolean {
  if (!result.nextQueries?.length) return false;
  if (result.nextQueries.length > 1) {
    result.nextQueries = result.nextQueries.slice(0, -1);
    return true;
  }
  const first = result.nextQueries[0]!;
  const argumentsJson = JSON.stringify(first.arguments);
  if (argumentsJson.length <= 400) return false;
  result.nextQueries[0] = {
    ...first,
    arguments: {
      cursor: first.arguments.cursor,
      detail: first.arguments.detail ?? "standard",
      limit: first.arguments.limit,
    },
  };
  return true;
}

function trimWindowSource(result: AgentToolResult): boolean {
  const windows = result.windows;
  if (!windows?.length) return false;

  for (let index = windows.length - 1; index >= 0; index -= 1) {
    const window = windows[index]!;
    if (typeof window.source !== "string" || window.source.length === 0) continue;
    if (window.source.length <= 240) {
      delete window.source;
      window.omitted = true;
      window.message = window.message
        ? `${window.message} Source omitted by tokenBudget.`
        : "Source omitted by tokenBudget.";
    } else {
      window.source = `${window.source.slice(0, Math.max(120, Math.floor(window.source.length / 2)))}\n[TRUNCATED by tokenBudget]`;
      window.message = window.message
        ? `${window.message} Source truncated by tokenBudget.`
        : "Source truncated by tokenBudget.";
    }
    return true;
  }

  return false;
}

function trimLargestArray(
  result: AgentToolResult,
  returned: Record<string, number>,
  omitted: Record<string, number>,
): boolean {
  let selectedKey: ArrayResultKey | null = null;
  let selectedBytes = 0;

  for (const key of ARRAY_RESULT_KEYS) {
    const value = result[key];
    if (!Array.isArray(value) || value.length === 0) continue;
    const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
    if (bytes > selectedBytes) {
      selectedBytes = bytes;
      selectedKey = key;
    }
  }

  if (!selectedKey) return false;
  const value = result[selectedKey];
  if (!Array.isArray(value) || value.length === 0) return false;
  (result as unknown as Record<ArrayResultKey, unknown[]>)[selectedKey] = value.slice(0, -1);
  returned[selectedKey] = Math.max(0, (returned[selectedKey] ?? value.length) - 1);
  omitted[selectedKey] = (omitted[selectedKey] ?? 0) + 1;
  return true;
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

interface ContextSeed {
  node: GraphNode;
  reasonCode: AgentReasonCode;
  reason: string;
  confidence: Confidence;
  priority: number;
}

function uniqueSeeds(seeds: ContextSeed[]): ContextSeed[] {
  const byId = new Map<string, ContextSeed>();
  for (const seed of seeds) {
    const existing = byId.get(seed.node.id);
    if (!existing || seed.priority > existing.priority) byId.set(seed.node.id, seed);
  }
  return [...byId.values()].sort((a, b) => b.priority - a.priority || sortByLoc(a.node, b.node));
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
  const kinds = input.kinds ? new Set<NodeKind>(input.kinds) : null;
  const nodes = ctx.report.nodes
    .map((node) => ({ node, score: scoreNode(node, input.query) }))
    .filter((item) => item.score > 0 && (!kinds || kinds.has(item.node.kind)))
    .sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id))
    .map((item) =>
      nodeReference(
        item.node,
        item.score >= 100 ? "high" : item.score >= 80 ? "medium" : "low",
        [`Search matched "${input.query}" with score ${item.score}`],
      ),
    );

  return finalizeAgentResult({
    tool: "graph_search",
    plan: ["Search report nodes by id, name, and source file", "Return deterministic ranked matches"],
    confidence: nodes.length ? nodes[0]!.confidence : "low",
    loc: nodes.find((node) => node.loc)?.loc ?? null,
    nodes,
    message: nodes.length ? `Found ${nodes.length} node(s).` : "No graph nodes matched.",
  }, input);
}

export function impactQuery(ctx: AgentQueryContext, input: ImpactQueryInput): AgentToolResult {
  const match = findBestNode(ctx.report, input);
  if (!match.node) {
    return finalizeAgentResult({
      tool: "impact_query",
      plan: ["Resolve the requested node", "No impact traversal runs without a node"],
      confidence: "low",
      loc: null,
      candidates: match.candidates.map((node) => nodeReference(node, "low")),
      message: "No matching node found for impact query.",
    }, input);
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
    .map(({ node, evidence }) => nodeReference(node, "high", [...new Set(evidence)].slice(0, 3)));
  const sourceRefs = sourceNodes
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

  return finalizeAgentResult({
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
  }, input);
}

export function findDeadCode(ctx: AgentQueryContext, input: FindDeadCodeInput = {}): AgentToolResult {
  const nodes = nodesById(ctx.report);
  const issues = ctx.report.issues
    .filter((issue) => issue.kind === "DEAD_CODE" || issue.kind === "UNUSED_ENDPOINT")
    .map((issue) => issueReference(issue, nodes))
    .filter((issue) => !input.confidence || issue.confidence === input.confidence);

  return finalizeAgentResult({
    tool: "find_dead_code",
    plan: ["Read existing DEAD_CODE and UNUSED_ENDPOINT issues from the report"],
    confidence: issues.length ? "medium" : "high",
    loc: issues.find((issue) => issue.loc)?.loc ?? null,
    issues,
    message: issues.length ? `Found ${issues.length} dead-code candidate(s).` : "No dead-code candidates found.",
  }, input);
}

export function checkBreakingChanges(
  ctx: AgentQueryContext,
  input: CheckBreakingChangesInput = {},
): AgentToolResult {
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
  const breakingChanges = [...diffBreaking, ...currentBreaking];

  return finalizeAgentResult({
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
  }, input);
}

export function getNodeContext(ctx: AgentQueryContext, input: GetNodeContextInput): AgentToolResult {
  const match = findBestNode(ctx.report, input);
  if (!match.node) {
    return finalizeAgentResult({
      tool: "get_node_context",
      plan: ["Resolve requested node", "No context can be returned without a node"],
      confidence: "low",
      loc: null,
      candidates: match.candidates.map((node) => nodeReference(node, "low")),
      message: "No matching node found for context query.",
    }, input);
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
    .map((edge) => edgeReference(edge, byId));
  const issues = ctx.report.issues
    .filter((issue) => issue.nodes.some((id) => contextIds.has(id)))
    .map((issue) => issueReference(issue, byId));

  return finalizeAgentResult({
    tool: "get_node_context",
    plan: [
      "Resolve node",
      ...(match.node.kind === "File" ? ["Expand the file node to contained symbols"] : []),
      "Collect incoming/outgoing graph edges",
      "Collect directly attached issues",
    ],
    confidence: match.confidence,
    loc: match.node.loc ?? null,
    nodes: contextNodes.map((node, index) =>
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
  }, input);
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

function packageNameForFile(file: string): "engine" | "desktop" | "workspace" {
  if (file.startsWith("engine/")) return "engine";
  if (file.startsWith("apps/desktop/")) return "desktop";
  return "workspace";
}

function stripPackagePrefix(file: string): string {
  return file
    .replace(/^engine\//, "")
    .replace(/^apps\/desktop\//, "");
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
  const limit = optionLimit(input, 12);
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
      if (/^engine\/src\/(agent|mcp|cli|index\.ts|types\.ts)/.test(file)) {
        add("pnpm --filter @code-mri/engine build", "Public engine or CLI/MCP surface changed", "high", loc);
      }
      if (file === "engine/src/types.ts") {
        add("pnpm --filter @code-mri/desktop typecheck", "Desktop consumes engine report types", "medium", loc);
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
  return finalizeAgentResult({
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
  }, input);
}

function repoRootForReportFile(report: Report, file: string): { root: string; rel: string } {
  for (const repo of report.project.repos ?? []) {
    const prefix = `${repo.id}/`;
    if (file === repo.id) return { root: repo.root, rel: "" };
    if (file.startsWith(prefix)) return { root: repo.root, rel: file.slice(prefix.length) };
  }
  return { root: report.project.root, rel: file };
}

function resolveReportFile(report: Report, file: string): string | null {
  const normalized = normalizeReportPath(file, report.project.root);
  const { root, rel } = repoRootForReportFile(report, normalized);
  if (path.isAbsolute(rel) || rel.split(/[\\/]+/).includes("..")) return null;
  const resolved = path.resolve(root, rel);
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(`${rootResolved}${path.sep}`)) return null;
  if (existsSync(resolved)) {
    const realRoot = realpathSync(rootResolved);
    const realResolved = realpathSync(resolved);
    if (realResolved !== realRoot && !realResolved.startsWith(`${realRoot}${path.sep}`)) return null;
  }
  return resolved;
}

function lineWindowForNode(
  node: GraphNode,
  reason: string,
  confidence: Confidence = "high",
  reasonCode: AgentReasonCode = "direct-match",
): AgentLineWindow | null {
  const file = filePathForNode(node);
  if (!file) return null;
  const line = node.loc?.line ?? 1;
  const radiusBefore = node.kind === "File" ? 1 : 8;
  const radiusAfter = node.kind === "File" ? 80 : 24;
  return {
    file,
    startLine: Math.max(1, line - radiusBefore),
    endLine: Math.max(line + radiusAfter, line),
    reasonCode,
    reason,
    confidence,
  };
}

function uniqueWindows(windows: AgentLineWindow[]): AgentLineWindow[] {
  const seen = new Set<string>();
  const out: AgentLineWindow[] = [];
  for (const window of windows) {
    const key = `${window.file}:${window.startLine}:${window.endLine}:${window.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(window);
  }
  return out;
}

function nodesFromFiles(ctx: AgentQueryContext, files: string[]): GraphNode[] {
  const normalized = new Set(files.map((file) => normalizeReportPath(file, ctx.report.project.root)));
  return ctx.report.nodes
    .filter((node) => {
      const file = filePathForNode(node);
      return file ? normalized.has(file) : false;
    })
    .sort(sortByLoc);
}

function nodesFromContextInput(ctx: AgentQueryContext, input: { files?: string[]; nodeIds?: string[]; task?: string }): ContextSeed[] {
  const byId = nodesById(ctx.report);
  const reportFiles = allReportFiles(ctx.report);
  const inputFiles = (input.files ?? []).map((file) => normalizeReportPath(file, ctx.report.project.root));
  const inputFileSet = new Set(inputFiles);
  const direct = (input.nodeIds ?? [])
    .map((id) => byId.get(id))
    .filter((node): node is GraphNode => Boolean(node));
  const fileNodes = nodesFromFiles(ctx, inputFiles);
  const searched =
    input.task && input.task.trim()
      ? (graphSearch(ctx, { query: input.task, limit: 10, detail: "brief" }).nodes ?? [])
          .map((node) => byId.get(node.id))
          .filter((node): node is GraphNode => Boolean(node))
      : [];
  const knownFiles = new Set([
    ...inputFileSet,
    ...direct.map(filePathForNode).filter((file): file is string => Boolean(file)),
    ...fileNodes.map(filePathForNode).filter((file): file is string => Boolean(file)),
  ]);

  const riskNodes = ctx.report.issues
    .filter((issue) => {
      const highRisk =
        issue.severity === "high" ||
        issue.kind.startsWith("BREAKING_") ||
        issue.kind === "BOUNDARY_VIOLATION" ||
        issue.kind === "UNCOVERED_RISKY_NODE";
      if (!highRisk) return false;
      if (input.task && scoreText(issue.message, input.task) > 0) return true;
      return issue.nodes.some((id) => {
        const node = byId.get(id);
        const file = node ? filePathForNode(node) : null;
        return file ? knownFiles.has(file) : false;
      });
    })
    .flatMap((issue) => issue.nodes)
    .map((id) => byId.get(id))
    .filter((node): node is GraphNode => Boolean(node));

  const hotspotNodes = (ctx.report.insights?.hotspots ?? [])
    .filter((hotspot) => {
      if (hotspot.file && knownFiles.has(hotspot.file)) return true;
      if (!input.task) return false;
      return scoreText(`${hotspot.name} ${hotspot.file ?? ""}`, input.task) > 0;
    })
    .map((hotspot) => byId.get(hotspot.nodeId))
    .filter((node): node is GraphNode => Boolean(node));

  const nearbyTests = inputFiles.flatMap((file) => nearbyTestFiles(reportFiles, file));
  const testNodes = nodesFromFiles(ctx, nearbyTests);

  return uniqueSeeds([
    ...direct.map((node) => ({
      node,
      reasonCode: "direct-match" as AgentReasonCode,
      reason: `Explicit node id selected for task: ${input.task ?? node.id}`,
      confidence: "high" as Confidence,
      priority: 100,
    })),
    ...fileNodes.map((node) => ({
      node,
      reasonCode: "direct-match" as AgentReasonCode,
      reason: `Explicit file selected for task: ${input.task ?? filePathForNode(node) ?? node.id}`,
      confidence: node.kind === "File" ? "medium" as Confidence : "high" as Confidence,
      priority: 95,
    })),
    ...riskNodes.map((node) => ({
      node,
      reasonCode: "breaking-risk" as AgentReasonCode,
      reason: `Selected because a high-risk issue matches this edit: ${input.task ?? node.id}`,
      confidence: "high" as Confidence,
      priority: 90,
    })),
    ...hotspotNodes.map((node) => ({
      node,
      reasonCode: "hotspot" as AgentReasonCode,
      reason: `Selected because Code MRI marked this node as a hotspot for: ${input.task ?? node.id}`,
      confidence: "high" as Confidence,
      priority: 85,
    })),
    ...testNodes.map((node) => ({
      node,
      reasonCode: "test-file" as AgentReasonCode,
      reason: `Nearby test context for requested file: ${input.task ?? filePathForNode(node) ?? node.id}`,
      confidence: "medium" as Confidence,
      priority: 75,
    })),
    ...searched.map((node) => ({
      node,
      reasonCode: "direct-match" as AgentReasonCode,
      reason: `Task text matched graph node: ${input.task ?? node.id}`,
      confidence: "medium" as Confidence,
      priority: 60,
    })),
  ]);
}

function issuesForNodes(ctx: AgentQueryContext, nodes: GraphNode[]): AgentIssueReference[] {
  const ids = new Set(nodes.map((node) => node.id));
  const byId = nodesById(ctx.report);
  return ctx.report.issues
    .filter((issue) => issue.nodes.some((id) => ids.has(id)))
    .map((issue) => issueReference(issue, byId));
}

function commandFilesFromWindows(windows: AgentLineWindow[]): string[] {
  return [...new Set(windows.map((window) => window.file))].sort();
}

export function prepareEditContext(
  ctx: AgentQueryContext,
  input: PrepareEditContextInput,
): AgentToolResult {
  const maxFiles = limitValue(input.maxFiles, detailValue(input.detail) === "full" ? 12 : 6);
  const maxWindows = limitValue(input.maxWindows, detailValue(input.detail) === "full" ? 16 : 8);
  const seeds = nodesFromContextInput(ctx, input).slice(0, maxFiles);
  const mustRead = uniqueWindows(
    seeds
      .map((seed) =>
        lineWindowForNode(
          seed.node,
          seed.reason,
          seed.confidence,
          seed.reasonCode,
        ),
      )
      .filter((window): window is AgentLineWindow => Boolean(window)),
  ).slice(0, maxWindows);

  const impactRefs: AgentNodeReference[] = [];
  for (const seed of seeds.slice(0, 3)) {
    impactRefs.push(...(impactQuery(ctx, { nodeId: seed.node.id, limit: 8, detail: "brief" }).candidates ?? []));
  }
  const uniqueImpactRefs = [...new Map(impactRefs.map((node) => [node.id, node])).values()];
  const impactedNodes = uniqueImpactRefs
    .map((node) => ctx.report.nodes.find((item) => item.id === node.id))
    .filter((node): node is GraphNode => Boolean(node));
  const maybeReadLater = uniqueWindows(
    impactedNodes
      .slice(0, maxWindows)
      .map((node) => lineWindowForNode(node, `Impacted by planned edit: ${input.task}`, "medium", "callee"))
      .filter((window): window is AgentLineWindow => Boolean(window)),
  ).filter((window) => !mustRead.some((item) => item.file === window.file && item.startLine === window.startLine));

  const seedNodes = seeds.map((seed) => seed.node);
  const risks = issuesForNodes(ctx, [...seedNodes, ...impactedNodes]).slice(0, 12);
  const testPlan = recommendTests(ctx, {
    files: commandFilesFromWindows([...mustRead, ...maybeReadLater]),
    limit: 8,
    detail: "brief",
  }).testCommands ?? [];

  const nextQueries: AgentNextQuery[] = [
    {
      tool: "read_windows",
      arguments: { windows: mustRead, mode: "source" },
      reason: "Read the minimal file/line windows instead of opening full files.",
    },
    {
      tool: "review_planned_change",
      arguments: { plan: input.task, files: commandFilesFromWindows(mustRead) },
      reason: "Check the planned edit against impact, risk, and verification data before modifying code.",
    },
  ];

  return finalizeAgentResult({
    tool: "prepare_edit_context",
    plan: [
      "Resolve task text, files, and node ids to report nodes",
      "Select minimal must-read source windows",
      "Collect impacted nodes, directly attached risks, and focused tests",
    ],
    confidence: seeds.length ? "medium" : "low",
    loc: seeds.find((seed) => seed.node.loc)?.node.loc ?? null,
    nodes: seeds.map((seed) => nodeReference(seed.node, seed.confidence, [seed.reason])),
    mustRead,
    maybeReadLater,
    impacts: uniqueImpactRefs,
    risks,
    testPlan,
    tokenSavings: estimateWindowSavings(ctx, mustRead),
    nextSteps: [
      "Read only the mustRead windows first",
      "Edit the smallest surface that satisfies the task",
      "Run review_diff after edits and then the recommended verification commands",
    ],
    nextQueries,
    message: seeds.length
      ? `Prepared ${mustRead.length} must-read window(s), ${uniqueImpactRefs.length} impact candidate(s), and ${testPlan.length} test command(s).`
      : "No strong graph match found; start with graph_search or provide files/nodeIds.",
  }, input);
}

function secretLinesForFile(ctx: AgentQueryContext, file: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const secret of ctx.report.insights?.secrets ?? []) {
    if (normalizeReportPath(secret.file, ctx.report.project.root) === file) {
      out.set(secret.line, secret.rule);
    }
  }
  return out;
}

export function readWindows(ctx: AgentQueryContext, input: ReadWindowsInput): AgentToolResult {
  const maxWindows = limitValue(input.maxWindows, detailValue(input.detail) === "full" ? 10 : 5);
  const maxLines = limitValue(input.maxLines, detailValue(input.detail) === "full" ? 80 : 40);
  const mode = input.mode ?? (input.includeSource === false ? "locations" : "source");
  const maxChars = maxValue(input.maxChars, mode === "locations" ? 2_000 : 12_000, 100_000);
  const windows: AgentSourceWindow[] = [];
  let usedChars = 0;

  for (const item of input.windows.slice(0, maxWindows)) {
    const file = normalizeReportPath(item.file, ctx.report.project.root);
    const resolved = resolveReportFile(ctx.report, file);
    if (!resolved || !existsSync(resolved)) {
      windows.push({ ...item, file, omitted: true, message: "File is outside the scanned root or no longer exists." });
      continue;
    }

    if (mode === "locations") {
      windows.push({ ...item, file, message: "Source omitted because mode=locations." });
      continue;
    }

    const text = readFileSync(resolved, "utf8");
    const lines = text.split(/\r?\n/);
    const startLine = Math.max(1, item.startLine);
    const endLine = Math.min(lines.length, Math.max(startLine, item.endLine), startLine + maxLines - 1);
    const secretLines = secretLinesForFile(ctx, file);
    const selected = lines.slice(startLine - 1, endLine).map((line, offset) => {
      const lineNumber = startLine + offset;
      const secretRule = secretLines.get(lineNumber);
      if (secretRule) return `[REDACTED secret candidate: ${secretRule}]`;
      return line;
    });
    const source =
      mode === "outline"
        ? selected
            .filter((line) =>
              /^\s*(export\s+)?(async\s+)?(function|class|interface|type|enum|const|let|var|def)\b|^\s*@\w/.test(line),
            )
            .join("\n")
        : selected.join("\n");
    const nextChars = Buffer.byteLength(source, "utf8");
    if (usedChars + nextChars > maxChars) {
      windows.push({ ...item, file, startLine, endLine, omitted: true, message: "Window omitted by maxChars budget." });
      continue;
    }
    usedChars += nextChars;
    windows.push({
      ...item,
      file,
      startLine,
      endLine,
      source,
      sha1: createHash("sha1").update(text).digest("hex"),
      redacted: selected.some((line) => line.startsWith("[REDACTED secret candidate:")),
    });
  }

  return finalizeAgentResult({
    tool: "read_windows",
    plan: [
      "Resolve requested repo-relative file windows",
      mode === "locations" ? "Return locations without source" : "Read bounded source snippets with secret redaction",
    ],
    confidence: windows.some((window) => !window.omitted) ? "high" : "low",
    loc: windows[0] ? { file: windows[0].file, line: windows[0].startLine } : null,
    windows,
    message: mode === "locations"
      ? `Returned ${windows.length} source window location(s); source content omitted.`
      : mode === "outline"
        ? `Returned outline snippets for ${windows.filter((window) => window.source !== undefined).length} bounded window(s).`
        : `Returned source for ${windows.filter((window) => window.source).length} bounded window(s).`,
  }, input);
}

function highRiskMessages(result: AgentToolResult): string[] {
  return (result.risks ?? [])
    .filter((issue) => issue.severity === "high" || issue.kind.startsWith("BREAKING_") || issue.kind === "BOUNDARY_VIOLATION")
    .map((issue) => issue.message);
}

export function reviewPlannedChange(
  ctx: AgentQueryContext,
  input: ReviewPlannedChangeInput,
): AgentToolResult {
  const context = prepareEditContext(ctx, {
    task: input.plan,
    files: input.files,
    nodeIds: input.nodeIds,
    detail: input.detail,
    tokenBudget: input.tokenBudget,
  });
  const mustFix = highRiskMessages(context);
  const shouldCheck = [
    ...(context.impacts?.length ? [`Review ${context.impacts.length} impacted node(s) before editing.`] : []),
    ...(context.mustRead?.length ? [`Read ${context.mustRead.length} must-read window(s), not whole files.`] : []),
  ];

  return finalizeAgentResult({
    ...context,
    tool: "review_planned_change",
    plan: [
      "Prepare edit context from the proposed plan",
      "Promote breaking, boundary, and high-severity risks to mustFix",
      "Return focused verification commands",
    ],
    mustFix,
    shouldCheck,
    safeToProceed: mustFix.length === 0,
    verificationCommands: context.testPlan,
    message: mustFix.length
      ? `Plan has ${mustFix.length} blocking risk(s) to address before editing.`
      : "No blocking graph risk found for the planned edit; proceed with the must-read windows and focused tests.",
  }, input);
}

function filesFromDiffText(diffText: string | undefined): string[] {
  if (!diffText) return [];
  const files = new Set<string>();
  for (const line of diffText.split(/\r?\n/)) {
    const diff = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (diff?.[2] && diff[2] !== "/dev/null") files.add(diff[2]);
    const plus = line.match(/^\+\+\+ b\/(.+)$/);
    if (plus?.[1] && plus[1] !== "/dev/null") files.add(plus[1]);
  }
  return [...files].sort();
}

function filesFromWorkingTree(ctx: AgentQueryContext): string[] {
  try {
    const root = ctx.report.project.root;
    const unstaged = execFileSync("git", ["diff", "--name-only"], { cwd: root, encoding: "utf8" });
    const staged = execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: root, encoding: "utf8" });
    return [...new Set(`${unstaged}\n${staged}`.split(/\r?\n/).filter(Boolean))].sort();
  } catch {
    return [];
  }
}

export function reviewDiff(ctx: AgentQueryContext, input: ReviewDiffInput = {}): AgentToolResult {
  const explicitFiles = [...(input.files ?? []), ...filesFromDiffText(input.diffText)];
  const files = [...new Set(explicitFiles.length ? explicitFiles : filesFromWorkingTree(ctx))].sort();
  const context = prepareEditContext(ctx, {
    task: files.length ? `Review changed files: ${files.join(", ")}` : "Review current diff",
    files,
    detail: input.detail,
    tokenBudget: input.tokenBudget,
  });
  const mustFix = highRiskMessages(context);
  const shouldCheck = files.length
    ? [`Changed files resolved from diff: ${files.join(", ")}`]
    : ["No changed file paths were resolved; provide diffText or files for stronger review."];

  return finalizeAgentResult({
    ...context,
    tool: "review_diff",
    plan: [
      "Resolve changed files from diff text and explicit files",
      "Compute edit context, impact, risk, and verification recommendations",
      "Classify blocking vs. follow-up checks",
    ],
    mustFix,
    shouldCheck,
    safeToProceed: mustFix.length === 0,
    verificationCommands: context.testPlan,
    message: mustFix.length
      ? `Diff review found ${mustFix.length} blocking risk(s).`
      : `Diff review found no blocking graph risk for ${files.length || "unknown"} changed file(s).`,
  }, input);
}

function fileBytes(ctx: AgentQueryContext, file: string): number {
  const resolved = resolveReportFile(ctx.report, file);
  if (!resolved || !existsSync(resolved)) return 0;
  return Buffer.byteLength(readFileSync(resolved));
}

function windowBytes(ctx: AgentQueryContext, window: AgentLineWindow): number {
  const resolved = resolveReportFile(ctx.report, window.file);
  if (!resolved || !existsSync(resolved)) return 0;
  const lines = readFileSync(resolved, "utf8").split(/\r?\n/);
  return Buffer.byteLength(lines.slice(Math.max(0, window.startLine - 1), window.endLine).join("\n"));
}

function estimateWindowSavings(ctx: AgentQueryContext, windows: AgentLineWindow[]): AgentTokenSavings {
  const files = new Set(windows.map((window) => normalizeReportPath(window.file, ctx.report.project.root)));
  const estimatedFullFileBytes = [...files].reduce((sum, file) => sum + fileBytes(ctx, file), 0);
  const returnedWindowBytes = windows.reduce((sum, window) => sum + windowBytes(ctx, window), 0);
  const avoidedBytes = Math.max(0, estimatedFullFileBytes - returnedWindowBytes);
  return {
    estimatedFullFileBytes,
    returnedWindowBytes,
    avoidedBytes,
    estimatedTokensAvoided: estimateTokens("x".repeat(avoidedBytes)),
    filesConsidered: files.size,
    windowsConsidered: windows.length,
  };
}

export function tokenSavingsReport(
  ctx: AgentQueryContext,
  input: TokenSavingsReportInput = {},
): AgentToolResult {
  const files = new Set((input.files ?? []).map((file) => normalizeReportPath(file, ctx.report.project.root)));
  for (const window of input.windows ?? []) files.add(normalizeReportPath(window.file, ctx.report.project.root));
  const windows = input.windows ?? [...files].map((file) => ({ file, startLine: 1, endLine: 80, reason: "default estimate", confidence: "low" as Confidence }));
  const tokenSavings = estimateWindowSavings(ctx, windows);

  return finalizeAgentResult({
    tool: "token_savings_report",
    plan: [
      "Estimate bytes for full files that would otherwise be read",
      "Estimate bytes for bounded source windows",
      "Report approximate avoided model context",
    ],
    confidence: files.size ? "medium" : "low",
    loc: windows[0] ? { file: windows[0].file, line: windows[0].startLine } : null,
    tokenSavings,
    message: files.size
      ? `Estimated ${tokenSavings.estimatedTokensAvoided} context token(s) avoided by using windows instead of full files.`
      : "No files or windows were provided for token savings estimation.",
  }, input);
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
  const common = {
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
    ...(input.detail ? { detail: input.detail } : {}),
    ...(input.tokenBudget !== undefined ? { tokenBudget: input.tokenBudget } : {}),
    ...(input.depth !== undefined ? { depth: input.depth } : {}),
    ...(input.includeEvidence !== undefined ? { includeEvidence: input.includeEvidence } : {}),
    ...(input.cursor ? { cursor: input.cursor } : {}),
  };

  if (/(breaking|break|kır|kir|what changed|diff|regression)/.test(q)) {
    return {
      tool: "check_breaking_changes",
      arguments: { ...common },
      rationale: "Question asks for breaking changes or diff risk.",
      confidence: "high",
    };
  }
  if (/(impact|affect|blast|etkilen|etkiler|değiş|degis|change)/.test(q)) {
    return {
      tool: "impact_query",
      arguments: { query, ...common },
      rationale: "Question asks what would be affected by a change.",
      confidence: "medium",
    };
  }
  if (/(dead|unused|ölü|olu|kullanılmayan|kullanilmayan)/.test(q)) {
    return {
      tool: "find_dead_code",
      arguments: { ...common },
      rationale: "Question asks for unused/dead code candidates.",
      confidence: "high",
    };
  }
  if (/(test|verify|verification|doğrula|dogrula|koş|kos|hangi komut|command)/.test(q)) {
    return {
      tool: "recommend_tests",
      arguments: { query, ...common },
      rationale: "Question asks which verification commands should run.",
      confidence: "high",
    };
  }
  if (/(context|detail|detay|neden|why|node)/.test(q)) {
    return {
      tool: "get_node_context",
      arguments: { query, ...common },
      rationale: "Question asks for context around a graph node.",
      confidence: "medium",
    };
  }

  return {
    tool: "graph_search",
    arguments: { query, ...common },
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

  return finalizeAgentResult({
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
  }, input);
}
