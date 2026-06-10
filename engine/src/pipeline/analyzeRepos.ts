import { readFileSync } from "node:fs";
import * as path from "node:path";
import {
  REPORT_SCHEMA_VERSION,
  type GraphEdge,
  type GraphNode,
  type ProjectRepoInfo,
  type ProjectRepoRole,
  type Report,
} from "@code-mri/shared-types";
import { loadCodeMriConfig, type CodeMriConfig } from "../config/codemri.js";
import { buildGraph } from "../graph/build.js";
import type { Graph } from "../graph/graph.js";
import { nodeId } from "../ids.js";
import { buildInsights, type InsightFile } from "../insights/index.js";
import { filterIgnoredRiskIssues } from "./filterIssues.js";
import { danglingApiCallIssues, linkCrossStack, type LinkResult } from "../linker/link.js";
import { runAnalyzers } from "../adapters/registry.js";
import type { AnalyzerResult, AnalyzeContext } from "../adapters/types.js";
import type { DockerAnalysis } from "../parsers/docker/analyze.js";
import { analyzeOpenApiSpec } from "../parsers/openapi/analyze.js";
import type { BackendRoute, PyAnalysis } from "../parsers/py/assemble.js";
import { createDiskPyCache } from "../parsers/py/cache.js";
import type { SidecarOptions } from "../parsers/py/sidecar.js";
import type { ResolvedApiCall, TsAnalysis } from "../parsers/ts/analyze.js";
import { createDiskFactsCache } from "../parsers/ts/cache.js";
import type { PerfCollector } from "../perf/collector.js";
import { progressEvent, type ScanProgressReporter } from "../progress.js";
import { runRules } from "../rules/index.js";
import { scanRepo, type ScanResult } from "../scanner/scan.js";
import { computeHealth } from "../scores/health.js";

export interface ProjectRepoInput {
  id: string;
  name: string;
  root: string;
  role: ProjectRepoRole;
}

export interface MultiRepoProjectInput {
  projectName: string;
  repos: ProjectRepoInput[];
}

export interface ProjectRepoAnalysis {
  repo: ProjectRepoInfo;
  scan: ScanResult;
  analyzers: AnalyzerResult;
  docker?: DockerAnalysis;
  ts?: TsAnalysis;
  py?: PyAnalysis;
}

export interface MultiRepoProjectAnalysis {
  repos: ProjectRepoAnalysis[];
  graph: Graph;
  link: LinkResult;
  report: Report;
}

export interface AnalyzeProjectReposOptions extends SidecarOptions {
  openapi?: string;
  /** Optional collector to record multi-repo phase timing and peak memory. */
  perf?: PerfCollector;
  /** Optional progress reporter for child-process stdout/UI handoff. */
  progress?: ScanProgressReporter;
  /** Optional lcov.info / Istanbul coverage JSON path. Auto-detected from coverage/ when omitted. */
  coverage?: string;
  /** Optional per-repo coverage paths keyed by normalized repo id. */
  coverageByRepo?: Record<string, string>;
  /** Enable git churn collection. Defaults to true and safely no-ops outside git repos. */
  git?: boolean;
  /** Bound git log history for deterministic, cheap churn collection. */
  maxGitCommits?: number;
  /** Explicit .codemri.yml path. Auto-discovered from the project roots when omitted. */
  configPath?: string;
  /** Pre-loaded governance config, mainly for tests and embedders. */
  config?: CodeMriConfig;
  /**
   * Directory for persistent incremental caches. Each repo gets its own
   * sub-directory (`<dir>/<repoId>/`) of disk-backed TS + Python caches so an
   * unchanged repo skips parsing entirely on the next scan.
   */
  incrementalDir?: string;
}

function timed<T>(
  perf: PerfCollector | undefined,
  name: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  return perf ? perf.phase(name, fn) : Promise.resolve().then(fn);
}

function countLines(abs: string): number {
  try {
    const text = readFileSync(abs, "utf8");
    return text.length === 0 ? 0 : text.split("\n").length;
  } catch {
    return 0;
  }
}

function repoPrefix(repo: ProjectRepoInput): string {
  return repo.id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function prefixedPath(prefix: string, rel: string): string {
  return `${prefix}/${rel}`.replace(/\/{2,}/g, "/");
}

function prefixedNodeId(prefix: string, id: string): string {
  const sep = id.indexOf(":");
  if (sep === -1) return prefixedPath(prefix, id);

  return `${id.slice(0, sep + 1)}${prefixedPath(prefix, id.slice(sep + 1))}`;
}

function prefixNode(prefix: string, node: GraphNode): GraphNode {
  const loc = node.loc
    ? {
        ...node.loc,
        file: prefixedPath(prefix, node.loc.file),
      }
    : undefined;
  const name = node.kind === "File" ? prefixedPath(prefix, node.name) : node.name;

  return {
    ...node,
    id: prefixedNodeId(prefix, node.id),
    loc,
    name,
  };
}

function prefixEdge(prefix: string, edge: GraphEdge): GraphEdge {
  const from = prefixedNodeId(prefix, edge.from);
  const to = prefixedNodeId(prefix, edge.to);

  return {
    ...edge,
    id: `${edge.kind}:${from}->${to}`,
    from,
    to,
  };
}

function prefixApiCall(prefix: string, call: ResolvedApiCall): ResolvedApiCall {
  return {
    ...call,
    file: prefixedPath(prefix, call.file),
    callerId: call.callerId ? prefixedNodeId(prefix, call.callerId) : null,
  };
}

function prefixRoute(prefix: string, route: BackendRoute): BackendRoute {
  return {
    ...route,
    viewsetId: route.viewsetId ? prefixedNodeId(prefix, route.viewsetId) : null,
    endpointId: prefixedNodeId(prefix, route.endpointId),
  };
}

function mergeStack(repos: ProjectRepoInfo[]): string[] {
  return [...new Set(repos.flatMap((repo) => repo.stack))].sort();
}

function validateRepos(repos: ProjectRepoInput[]) {
  if (repos.length === 0) {
    throw new Error("At least one repository is required");
  }

  const ids = new Set<string>();
  for (const repo of repos) {
    const prefix = repoPrefix(repo);
    if (!prefix) throw new Error(`Invalid repository id: ${repo.id}`);
    if (ids.has(prefix)) throw new Error(`Duplicate repository id: ${repo.id}`);
    ids.add(prefix);
  }
}

interface RepoFragment {
  analysis: ProjectRepoAnalysis;
  nodes: GraphNode[];
  edges: GraphEdge[];
  apiCalls: ResolvedApiCall[];
  routes: BackendRoute[];
  loc: [string, number][];
  insightFiles: InsightFile[];
}

/** Scan + parse a single repo into a fully prefixed, mergeable fragment. */
async function analyzeOneRepo(
  repoInput: ProjectRepoInput,
  opts: AnalyzeProjectReposOptions,
): Promise<RepoFragment> {
  const prefix = repoPrefix(repoInput);
  const scan = await scanRepo(repoInput.root);

  const repoCacheDir = opts.incrementalDir
    ? path.join(opts.incrementalDir, prefix)
    : undefined;
  const tsCache = repoCacheDir
    ? createDiskFactsCache(path.join(repoCacheDir, "ts-facts.json"))
    : undefined;
  const pyCache = repoCacheDir
    ? createDiskPyCache(path.join(repoCacheDir, "py-analysis.json"))
    : undefined;

  const ctx: AnalyzeContext = {
    scan,
    options: {
      ...(opts.python ? { python: opts.python } : {}),
    },
    tsCache,
    pyCache,
  };
  const parsed = await runAnalyzers(ctx);
  tsCache?.flush();
  pyCache?.flush();

  const repo: ProjectRepoInfo = {
    id: prefix,
    name: repoInput.name,
    root: scan.root,
    role: repoInput.role,
    stack: scan.stack,
  };

  const nodes: GraphNode[] = [];
  const loc: [string, number][] = [];
  const insightFiles: InsightFile[] = [];
  for (const file of scan.files) {
    const rel = prefixedPath(prefix, file.path);
    loc.push([nodeId("File", rel), countLines(file.abs)]);
    nodes.push({ id: nodeId("File", rel), kind: "File", name: rel, loc: { file: rel } });
    insightFiles.push({
      path: file.path,
      graphPath: rel,
      abs: file.abs,
      category: file.category,
    });
  }
  nodes.push(...parsed.nodes.map((node) => prefixNode(prefix, node)));

  const edges: GraphEdge[] = parsed.edges.map((edge) => prefixEdge(prefix, edge));

  return {
    analysis: { repo, scan, analyzers: parsed },
    nodes,
    edges,
    apiCalls: parsed.apiCalls.map((call) => prefixApiCall(prefix, call)),
    routes: parsed.routes.map((route) => prefixRoute(prefix, route)),
    loc,
    insightFiles,
  };
}

export async function analyzeProjectRepos(
  input: MultiRepoProjectInput,
  opts: AnalyzeProjectReposOptions = {},
): Promise<MultiRepoProjectAnalysis> {
  validateRepos(input.repos);
  const { perf, progress } = opts;
  const config =
    opts.config ??
    loadCodeMriConfig({
      roots: input.repos.map((repo) => repo.root),
      configPath: opts.configPath,
    });
  progress?.(
    progressEvent({
      phase: "repos",
      percent: 0,
      message: `Scanning ${input.repos.length} repos`,
    }),
  );

  // Repos are independent — scan/parse them in parallel, then merge fragments
  // in input order so node/edge order (and the golden report) stays deterministic.
  let completedRepos = 0;
  const fragments = await timed(perf, "repos", () =>
    Promise.all(
      input.repos.map(async (repoInput) => {
        progress?.(
          progressEvent({
            phase: "repo",
            percent: 5,
            repoId: repoPrefix(repoInput),
            message: `Scanning ${repoInput.name}`,
          }),
        );
        const fragment = await analyzeOneRepo(repoInput, opts);
        completedRepos++;
        progress?.(
          progressEvent({
            phase: "repo",
            percent: 5 + (completedRepos / input.repos.length) * 70,
            repoId: fragment.analysis.repo.id,
            message: `Finished ${repoInput.name}`,
          }),
        );
        return fragment;
      }),
    ),
  );

  const repoAnalyses: ProjectRepoAnalysis[] = [];
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const apiCalls: ResolvedApiCall[] = [];
  const routes: BackendRoute[] = [];
  const loc = new Map<string, number>();
  const insightRepos: Array<{ id: string; root: string; files: InsightFile[] }> = [];
  for (const fragment of fragments) {
    repoAnalyses.push(fragment.analysis);
    nodes.push(...fragment.nodes);
    edges.push(...fragment.edges);
    apiCalls.push(...fragment.apiCalls);
    routes.push(...fragment.routes);
    for (const [id, count] of fragment.loc) loc.set(id, count);
    insightRepos.push({
      id: fragment.analysis.repo.id,
      root: fragment.analysis.scan.root,
      files: fragment.insightFiles,
    });
  }

  const openapi = await timed(perf, "openapi", () =>
    opts.openapi ? analyzeOpenApiSpec(process.cwd(), opts.openapi) : { nodes: [], routes: [] },
  );
  progress?.(progressEvent({ phase: "link", percent: 80, message: "Linking cross-stack calls" }));
  const link = await timed(perf, "link", () => linkCrossStack(apiCalls, [...routes, ...openapi.routes]));
  progress?.(progressEvent({ phase: "graph", percent: 88, message: "Building graph" }));
  const graph = await timed(perf, "graph", () => {
    const built = buildGraph({ nodes, edges }, { nodes: [], edges: link.edges });
    for (const node of openapi.nodes) built.addNode(node);
    return built;
  });
  progress?.(progressEvent({ phase: "insights", percent: 91, message: "Collecting insights" }));
  const insights = await timed(perf, "insights", () =>
    buildInsights({
      graph,
      repos: insightRepos,
      coverage: opts.coverage,
      coverageByRepo: opts.coverageByRepo,
      git: opts.git,
      maxGitCommits: opts.maxGitCommits,
    }),
  );
  progress?.(progressEvent({ phase: "rules", percent: 94, message: "Running rules" }));
  const rawIssues = await timed(perf, "rules", () => {
    return [
      ...runRules(graph, { loc, config }),
      ...danglingApiCallIssues(link.unmatched),
      ...insights.issues,
    ];
  });
  const graphNodes = insights.nodes;
  const issues = filterIgnoredRiskIssues(rawIssues, graphNodes, config);
  const scores = computeHealth(issues);
  const repos = repoAnalyses.map((analysis) => analysis.repo);
  const report: Report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    project: {
      name: input.projectName,
      stack: mergeStack(repos),
      root: repos.map((repo) => repo.root).join(path.delimiter),
      repos,
    },
    summary: {
      files: repoAnalyses.reduce((sum, analysis) => sum + analysis.scan.files.length, 0),
      components: graphNodes.filter((node) => node.kind === "Component").length,
      models: graphNodes.filter((node) => node.kind === "Model").length,
      endpoints: graphNodes.filter((node) => node.kind === "APIEndpoint").length,
    },
    nodes: graphNodes,
    edges: graph.edges(),
    issues,
    scores,
    insights: insights.insights,
  };

  progress?.(progressEvent({ phase: "done", percent: 100, message: "Scan complete" }));
  return { repos: repoAnalyses, graph, link, report };
}
