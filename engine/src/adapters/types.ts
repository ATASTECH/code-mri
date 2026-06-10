import type { GraphEdge, GraphNode } from "@code-mri/shared-types";
import type { BackendRoute } from "../parsers/py/assemble.js";
import type { PyCache } from "../parsers/py/cache.js";
import type { SidecarOptions } from "../parsers/py/sidecar.js";
import type { ResolvedApiCall } from "../parsers/ts/analyze.js";
import type { FactsCache } from "../parsers/ts/cache.js";
import type { ScanResult } from "../scanner/scan.js";

/**
 * Contribution of a single analyzer: graph fragment plus the two cross-stack
 * linker inputs (`apiCalls` from frontends, `routes` from backends). Analyzers
 * that don't produce one simply return an empty array for it.
 */
export interface AnalyzerResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  routes: BackendRoute[];
  apiCalls: ResolvedApiCall[];
}

/** Everything an analyzer may need: the scan, run options, and shared caches. */
export interface AnalyzeContext {
  scan: ScanResult;
  options: SidecarOptions & { openapi?: string };
  tsCache?: FactsCache;
  pyCache?: PyCache;
}

/**
 * Uniform analyzer contract behind the registry. `detect` gates `analyze` on
 * the scanned project (stack tags, file categories, or run options) so the
 * pipeline can stay framework-agnostic — every analyzer (TS, Python, Docker,
 * OpenAPI, and each web framework) registers here rather than being hardcoded.
 */
export interface Analyzer {
  name: string;
  detect(ctx: AnalyzeContext): boolean;
  analyze(ctx: AnalyzeContext): AnalyzerResult | Promise<AnalyzerResult>;
}
