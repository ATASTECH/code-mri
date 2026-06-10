import { analyzeDockerCompose } from "../parsers/docker/analyze.js";
import { analyzeExpress } from "../parsers/express/index.js";
import { analyzeNest } from "../parsers/nest/index.js";
import { analyzeOpenApiSpec } from "../parsers/openapi/analyze.js";
import { analyzePython } from "../parsers/py/analyze.js";
import { analyzeReactRouter } from "../parsers/react-router/index.js";
import { analyzeTypeScript } from "../parsers/ts/analyze.js";
import type { ScanResult } from "../scanner/scan.js";
import type { AnalyzeContext, Analyzer, AnalyzerResult } from "./types.js";

const EMPTY: Pick<AnalyzerResult, "routes" | "apiCalls"> = { routes: [], apiCalls: [] };

/** Repo-relative TS/JS files in the shape the framework analyzers expect. */
function tsFileRefs(scan: ScanResult): { path: string; abs: string }[] {
  return scan.files
    .filter((f) => f.category === "typescript")
    .map((f) => ({ path: f.path, abs: f.abs }));
}

const hasCategory = (scan: ScanResult, category: string) =>
  scan.files.some((f) => f.category === category);

// --- Core language/spec analyzers -----------------------------------------

export const typescriptAnalyzer: Analyzer = {
  name: "typescript",
  detect: (ctx) => hasCategory(ctx.scan, "typescript"),
  analyze: (ctx) => {
    const tsFiles = ctx.scan.files.filter((f) => f.category === "typescript");
    const packageJsonPaths = ctx.scan.files
      .filter((f) => f.path === "package.json" || f.path.endsWith("/package.json"))
      .map((f) => f.path);
    const r = analyzeTypeScript(ctx.scan.root, tsFiles, { cache: ctx.tsCache, packageJsonPaths });
    return { nodes: r.nodes, edges: r.edges, routes: [], apiCalls: r.apiCalls };
  },
};

export const dockerAnalyzer: Analyzer = {
  name: "docker",
  detect: (ctx) => hasCategory(ctx.scan, "docker"),
  analyze: (ctx) => {
    const dockerFiles = ctx.scan.files.filter((f) => f.category === "docker");
    const r = analyzeDockerCompose(ctx.scan.root, dockerFiles);
    return { nodes: r.nodes, edges: r.edges, ...EMPTY };
  },
};

export const openapiAnalyzer: Analyzer = {
  name: "openapi",
  detect: (ctx) => Boolean(ctx.options.openapi),
  analyze: (ctx) => {
    const r = analyzeOpenApiSpec(ctx.scan.root, ctx.options.openapi as string);
    return { nodes: r.nodes, edges: [], routes: r.routes, apiCalls: [] };
  },
};

export const pythonAnalyzer: Analyzer = {
  name: "python",
  detect: (ctx) => hasCategory(ctx.scan, "python"),
  analyze: async (ctx) => {
    const pyFiles = ctx.scan.files.filter((f) => f.category === "python").map((f) => f.path);
    const r = await analyzePython(ctx.scan.root, pyFiles, ctx.options, ctx.pyCache);
    return { nodes: r.nodes, edges: r.edges, routes: r.routes, apiCalls: [] };
  },
};

// --- Web framework analyzers ----------------------------------------------

export const expressAnalyzer: Analyzer = {
  name: "express",
  detect: (ctx) => ctx.scan.stack.includes("express"),
  analyze: (ctx) => ({ ...analyzeExpress(ctx.scan.root, tsFileRefs(ctx.scan)), apiCalls: [] }),
};

export const nestAnalyzer: Analyzer = {
  name: "nest",
  detect: (ctx) => ctx.scan.stack.includes("nest"),
  analyze: (ctx) => ({ ...analyzeNest(ctx.scan.root, tsFileRefs(ctx.scan)), apiCalls: [] }),
};

export const reactRouterAnalyzer: Analyzer = {
  name: "react-router",
  // Non-Next React SPAs (Vite/CRA); Next has its own file-based routing.
  detect: (ctx) => ctx.scan.stack.includes("vite") || ctx.scan.stack.includes("cra"),
  analyze: (ctx) => ({ ...analyzeReactRouter(ctx.scan.root, tsFileRefs(ctx.scan)), apiCalls: [] }),
};

/** Every registered analyzer. Order is not significant (graph dedups by id). */
export const ANALYZERS: Analyzer[] = [
  typescriptAnalyzer,
  dockerAnalyzer,
  openapiAnalyzer,
  pythonAnalyzer,
  expressAnalyzer,
  nestAnalyzer,
  reactRouterAnalyzer,
];

/** Run every analyzer whose `detect` passes and merge their contributions. */
export async function runAnalyzers(
  ctx: AnalyzeContext,
  analyzers: Analyzer[] = ANALYZERS,
): Promise<AnalyzerResult> {
  const out: AnalyzerResult = { nodes: [], edges: [], routes: [], apiCalls: [] };
  for (const analyzer of analyzers) {
    if (!analyzer.detect(ctx)) continue;
    const r = await analyzer.analyze(ctx);
    out.nodes.push(...r.nodes);
    out.edges.push(...r.edges);
    out.routes.push(...r.routes);
    out.apiCalls.push(...r.apiCalls);
  }
  return out;
}
