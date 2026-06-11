import type { Issue } from "../types.js";
import type { BoundaryConfig, CodeMriConfig, PublicApiConfig } from "../config/codemri.js";
import type { Graph } from "../graph/graph.js";
import { findBoundaryViolations } from "./boundaries.js";
import { findCircularDependencies } from "./circular.js";
import { findDeadCode } from "./deadCode.js";
import { findGodModels, findLargeFiles } from "./size.js";

export interface RuleOptions {
  /** File node id -> line count, enables LARGE_FILE. */
  loc?: Map<string, number>;
  /** Field-count threshold for GOD_MODEL (default 15). */
  godModelFields?: number;
  /** Line threshold for LARGE_FILE (default 300). */
  largeFileLines?: number;
  /** Loaded .codemri.yml governance config. */
  config?: CodeMriConfig;
  boundaries?: BoundaryConfig;
  publicApi?: PublicApiConfig;
}

/** Run every rule against the graph and return the combined issue list. */
export function runRules(graph: Graph, opts: RuleOptions = {}): Issue[] {
  const boundaries = opts.boundaries ?? opts.config?.boundaries;
  const publicApi = opts.publicApi ?? opts.config?.publicApi;
  return [
    ...findCircularDependencies(graph),
    ...findDeadCode(graph, { publicApi }),
    ...findBoundaryViolations(graph, boundaries),
    ...findGodModels(graph, opts.godModelFields ?? 15),
    ...(opts.loc ? findLargeFiles(graph, opts.loc, opts.largeFileLines ?? 300) : []),
  ];
}

export {
  findBoundaryViolations,
  findCircularDependencies,
  findDeadCode,
  findGodModels,
  findLargeFiles,
};
