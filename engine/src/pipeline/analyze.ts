import { readFileSync } from "node:fs";
import * as path from "node:path";
import { REPORT_SCHEMA_VERSION, type GraphNode, type Report } from "@code-mri/shared-types";
import { loadCodeMriConfig, type CodeMriConfig } from "../config/codemri.js";
import { buildGraph } from "../graph/build.js";
import type { Graph } from "../graph/graph.js";
import { nodeId } from "../ids.js";
import { runAnalyzers } from "../adapters/registry.js";
import type { AnalyzeContext } from "../adapters/types.js";
import { danglingApiCallIssues, linkCrossStack, type LinkResult } from "../linker/link.js";
import { buildInsights, insightFilesFromScan } from "../insights/index.js";
import { filterIgnoredRiskIssues } from "./filterIssues.js";
import { createDiskPyCache, type PyCache } from "../parsers/py/cache.js";
import type { SidecarOptions } from "../parsers/py/sidecar.js";
import { createDiskFactsCache, type FactsCache } from "../parsers/ts/cache.js";
import type { PerfCollector } from "../perf/collector.js";
import { runRules } from "../rules/index.js";
import { scanRepo, type ScanResult } from "../scanner/scan.js";
import { computeHealth } from "../scores/health.js";

export interface ProjectAnalysis {
  scan: ScanResult;
  graph: Graph;
  link: LinkResult;
  report: Report;
}

export interface AnalyzeProjectOptions extends SidecarOptions {
  openapi?: string;
  /** Optional collector to record per-phase timing and peak memory. */
  perf?: PerfCollector;
  /** Optional content-hash cache so unchanged TS files skip parsing. */
  cache?: FactsCache;
  /** Optional whole-result cache so an unchanged Django side skips the sidecar. */
  pyCache?: PyCache;
  /** Optional lcov.info / Istanbul coverage JSON path. Auto-detected from coverage/ when omitted. */
  coverage?: string;
  /** Enable git churn collection. Defaults to true and safely no-ops outside git repos. */
  git?: boolean;
  /** Bound git log history for deterministic, cheap churn collection. */
  maxGitCommits?: number;
  /** Explicit .codemri.yml path. Auto-discovered from the scanned root when omitted. */
  configPath?: string;
  /** Pre-loaded governance config, mainly for tests and embedders. */
  config?: CodeMriConfig;
  /**
   * Directory for persistent incremental caches. When set (and explicit
   * `cache`/`pyCache` are not), disk-backed TS + Python caches are created,
   * used, and flushed under this directory — enabling cross-run incremental scans.
   */
  incrementalDir?: string;
}

/** Run `fn` under the collector phase if present, otherwise run it directly. */
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

/** Full engine pipeline: scan → parse (TS + Django) → graph → link → rules → report. */
export async function analyzeProject(
  root: string,
  opts: AnalyzeProjectOptions = {},
): Promise<ProjectAnalysis> {
  const { perf, incrementalDir } = opts;
  const config = opts.config ?? loadCodeMriConfig({ root, configPath: opts.configPath });

  // Persistent incremental caches (only when a dir is given and no explicit
  // cache was injected). Flushed after the report is built.
  const diskTs =
    incrementalDir && !opts.cache
      ? createDiskFactsCache(path.join(incrementalDir, "ts-facts.json"))
      : undefined;
  const diskPy =
    incrementalDir && !opts.pyCache
      ? createDiskPyCache(path.join(incrementalDir, "py-analysis.json"))
      : undefined;
  const tsCache = opts.cache ?? diskTs;
  const pyCache = opts.pyCache ?? diskPy;

  const scan = await timed(perf, "scan", () => scanRepo(root));

  // Every analyzer (TS, Python, Docker, OpenAPI, web frameworks) runs through
  // one registry; each is detect-gated and contributes graph + linker inputs.
  const ctx: AnalyzeContext = { scan, options: opts, tsCache, pyCache };
  const parsed = await timed(perf, "parse", () => runAnalyzers(ctx));

  const link = await timed(perf, "link", () =>
    linkCrossStack(parsed.apiCalls, parsed.routes),
  );

  const graph = await timed(perf, "graph", () => {
    // File nodes for every scanned file (so file-level rules see all of them).
    const fileNodes: GraphNode[] = scan.files.map((f) => ({
      id: nodeId("File", f.path),
      kind: "File",
      name: f.path,
      loc: { file: f.path },
    }));

    return buildGraph(
      { nodes: fileNodes, edges: [] },
      { nodes: parsed.nodes, edges: parsed.edges },
      { nodes: [], edges: link.edges },
    );
  });

  const insights = await timed(perf, "insights", () =>
    buildInsights({
      graph,
      repos: [
        {
          root: scan.root,
          files: insightFilesFromScan(scan.files),
          ...(opts.coverage ? { coveragePath: opts.coverage } : {}),
        },
      ],
      coverage: opts.coverage,
      git: opts.git,
      maxGitCommits: opts.maxGitCommits,
    }),
  );

  const rawIssues = await timed(perf, "rules", () => {
    const loc = new Map<string, number>();
    for (const f of scan.files) loc.set(nodeId("File", f.path), countLines(f.abs));
    return [
      ...runRules(graph, { loc, config }),
      ...danglingApiCallIssues(link.unmatched),
      ...insights.issues,
    ];
  });

  const nodes = insights.nodes;
  const issues = filterIgnoredRiskIssues(rawIssues, nodes, config);
  const scores = computeHealth(issues);
  const report: Report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    project: { name: path.basename(scan.root), stack: scan.stack, root: scan.root },
    summary: {
      files: scan.files.length,
      components: nodes.filter((n) => n.kind === "Component").length,
      models: nodes.filter((n) => n.kind === "Model").length,
      endpoints: nodes.filter((n) => n.kind === "APIEndpoint").length,
    },
    nodes,
    edges: graph.edges(),
    issues,
    scores,
    insights: insights.insights,
  };

  diskTs?.flush();
  diskPy?.flush();

  return { scan, graph, link, report };
}
