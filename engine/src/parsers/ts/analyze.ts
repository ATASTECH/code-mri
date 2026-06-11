import { readFileSync } from "node:fs";
import * as path from "node:path";
import { Project, ts } from "ts-morph";
import type { GraphEdge, GraphNode, NodeKind } from "../../types.js";
import { edgeId, nodeId } from "../../ids.js";
import type { ApiCall } from "./apiCalls.js";
import { type FactsCache, hashContent } from "./cache.js";
import { extractTsFacts, type TsFileFacts } from "./facts.js";
import { createModuleResolver, type ModuleResolver } from "./resolveModule.js";
import { readTsResolverConfig } from "./tsconfig.js";
import { readWorkspacePackages } from "./workspace.js";

export interface ResolvedApiCall extends ApiCall {
  /** Repo-relative file the call lives in. */
  file: string;
  /** Node id of the enclosing component/hook, if any. */
  callerId: string | null;
  /** baseURL-joined url, e.g. "/api/users/". */
  fullUrl: string;
}

export interface TsAnalysis {
  nodes: GraphNode[];
  edges: GraphEdge[];
  apiCalls: ResolvedApiCall[];
}

/** Files above this size are skipped (minified bundles / generated code blow up ts-morph). */
export const DEFAULT_MAX_PARSE_BYTES = 1_500_000;
export const DEFAULT_PARSE_BATCH_SIZE = 128;

export interface AnalyzeTsOptions {
  /** Optional content-hash cache so unchanged files skip ts-morph parsing. */
  cache?: FactsCache;
  /** Skip parsing files larger than this many bytes. Defaults to ~1.5MB. */
  maxParseBytes?: number;
  /** Parse cache misses in fresh ts-morph Projects of this size to cap retained compiler memory. */
  parseBatchSize?: number;
  /** Repo-relative `package.json` paths, enabling monorepo workspace resolution. */
  packageJsonPaths?: string[];
}

/** Empty facts for a file we deliberately do not parse (too large). */
function emptyFacts(rel: string): TsFileFacts {
  return {
    rel,
    decls: [],
    types: [],
    contexts: [],
    imports: [],
    reExports: [],
    dynamicImports: [],
    axiosClients: {},
    fileApiCalls: [],
  };
}

interface SymbolRef {
  id: string;
  kind: NodeKind;
}

/** A file under a Next.js routing directory hosts Page components. */
function isPageFile(rel: string): boolean {
  return /(^|\/)(pages|app)\//.test(rel);
}

/** The effective node kind for a declaration (default page export → Page). */
function declNodeKind(
  kind: NodeKind,
  isDefaultExport: boolean,
  inPageFile: boolean,
): NodeKind {
  return isDefaultExport && inPageFile && kind === "Component" ? "Page" : kind;
}

function joinUrl(base: string | undefined, url: string): string {
  if (/^https?:\/\//.test(url)) return url;
  if (!base) return url;
  const b = base.replace(/\/+$/, "");
  const u = url.startsWith("/") ? url : `/${url}`;
  return b + u;
}

function createTsProject(): Project {
  return new Project({
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      allowJs: true,
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
  });
}

/**
 * Analyze the TypeScript/Next.js side of a repo into graph fragments.
 * Produces File/Component/Hook/Page nodes, IMPORTS/RENDERS/USES edges, and a
 * list of API calls (with baseURL-resolved urls) for the cross-stack linker.
 *
 * Parsing is split into per-file fact extraction (ts-morph, content-hash
 * cacheable) and a pure graph build, so an unchanged file served from `cache`
 * never touches ts-morph — on a full cache hit no Project is created at all.
 */
export function analyzeTypeScript(
  root: string,
  files: { path: string; abs: string }[],
  opts: AnalyzeTsOptions = {},
): TsAnalysis {
  // Own module resolver (relative + tsconfig path aliases) so import edges no
  // longer depend on ts-morph having every target file parsed in the Project.
  const resolveModule = createModuleResolver({
    files: files.map((f) => f.path),
    ...readTsResolverConfig(root),
    workspaces: readWorkspacePackages(root, opts.packageJsonPaths ?? []),
  });

  const { cache } = opts;
  const maxParseBytes = opts.maxParseBytes ?? DEFAULT_MAX_PARSE_BYTES;
  const parseBatchSize = Math.max(1, opts.parseBatchSize ?? DEFAULT_PARSE_BATCH_SIZE);
  const factsByFile: TsFileFacts[] = new Array(files.length);
  const pending: Array<{ index: number; file: { path: string; abs: string }; text: string; hash: string }> = [];

  for (let index = 0; index < files.length; index++) {
    const f = files[index] as { path: string; abs: string };
    const text = readFileSync(path.resolve(f.abs), "utf8");
    const hash = hashContent(text);
    const cached = cache?.get(f.path, hash);
    if (cached) {
      factsByFile[index] = cached;
      continue;
    }
    if (Buffer.byteLength(text, "utf8") > maxParseBytes) {
      // Too large to parse safely (minified/generated) — record empty facts.
      const facts = emptyFacts(f.path);
      cache?.set(f.path, hash, facts);
      factsByFile[index] = facts;
      continue;
    }
    pending.push({ index, file: f, text, hash });
  }

  for (let start = 0; start < pending.length; start += parseBatchSize) {
    const project = createTsProject();
    for (const item of pending.slice(start, start + parseBatchSize)) {
      const sf = project.createSourceFile(path.resolve(item.file.abs), item.text, { overwrite: true });
      const facts = extractTsFacts(sf, item.file.path);
      cache?.set(item.file.path, item.hash, facts);
      factsByFile[item.index] = facts;
    }
  }

  return buildTsAnalysis(factsByFile, resolveModule);
}

/** Assemble graph fragments from per-file facts. Pure: no ts-morph. */
function buildTsAnalysis(
  factsByFile: TsFileFacts[],
  resolveModule: ModuleResolver,
): TsAnalysis {
  const nodes: GraphNode[] = [];
  const nodeIndex = new Set<string>();
  const addNode = (n: GraphNode) => {
    if (!nodeIndex.has(n.id)) {
      nodeIndex.add(n.id);
      nodes.push(n);
    }
  };

  const edges: GraphEdge[] = [];
  const edgeIndex = new Set<string>();
  const addEdge = (
    kind: GraphEdge["kind"],
    from: string,
    to: string,
    confidence?: GraphEdge["confidence"],
  ) => {
    const id = edgeId(kind, from, to);
    if (!edgeIndex.has(id)) {
      edgeIndex.add(id);
      edges.push({ id, from, to, kind, ...(confidence ? { confidence } : {}) });
    }
  };

  // Pass 1: nodes + per-file export tables + project-wide axios baseURLs.
  const exportsByFile = new Map<string, Map<string, SymbolRef>>();
  const axiosClients: Record<string, string> = {};
  for (const facts of factsByFile) {
    const { rel } = facts;
    const inPage = isPageFile(rel);
    addNode({ id: nodeId("File", rel), kind: "File", name: rel, loc: { file: rel } });
    const exports = new Map<string, SymbolRef>();
    for (const d of facts.decls) {
      const kind = declNodeKind(d.rawKind, d.isDefaultExport, inPage);
      const id = nodeId(kind, rel, d.name);
      const exported = d.isExported || d.isDefaultExport;
      addNode({
        id,
        kind,
        name: d.name,
        loc: { file: rel, line: d.line },
        meta: { exported, fieldReads: d.fieldReadNames },
      });
      if (exported) {
        const ref: SymbolRef = { id, kind };
        exports.set(d.name, ref);
        if (d.isDefaultExport) exports.set("default", ref);
      }
    }
    for (const t of facts.types) {
      const id = nodeId("Type", rel, t.name);
      addNode({
        id,
        kind: "Type",
        name: t.name,
        loc: { file: rel, line: t.line },
        meta: { exported: t.isExported, typeKind: t.kind, fields: t.fields },
      });
      if (t.isExported) exports.set(t.name, { id, kind: "Type" });
    }
    for (const c of facts.contexts) {
      const id = nodeId("Context", rel, c.name);
      addNode({
        id,
        kind: "Context",
        name: c.name,
        loc: { file: rel, line: c.line },
        meta: { exported: c.isExported },
      });
      if (c.isExported) exports.set(c.name, { id, kind: "Context" });
    }
    exportsByFile.set(rel, exports);
    Object.assign(axiosClients, facts.axiosClients);
  }

  // Pass 1.5: resolve barrel re-exports so `export { X } from "./X"` and
  // `export * from "./X"` make X available on the barrel's export table.
  // Iterated to a fixpoint so chained barrels (index → index) resolve too.
  for (let guard = 0; guard < 10; guard++) {
    let changed = false;
    for (const facts of factsByFile) {
      if (facts.reExports.length === 0) continue;
      const exports = exportsByFile.get(facts.rel);
      if (!exports) continue;
      for (const re of facts.reExports) {
        const targetRel = resolveModule(facts.rel, re.source);
        if (!targetRel) continue;
        const targetExports = exportsByFile.get(targetRel);
        if (!targetExports) continue;
        if (re.star) {
          for (const [name, ref] of targetExports) {
            if (name === "default") continue; // `export *` never re-exports default
            if (!exports.has(name)) {
              exports.set(name, ref);
              changed = true;
            }
          }
        } else {
          for (const ni of re.named) {
            const ref = targetExports.get(ni.name);
            const local = ni.alias ?? ni.name;
            if (ref && !exports.has(local)) {
              exports.set(local, ref);
              changed = true;
            }
          }
        }
      }
    }
    if (!changed) break;
  }

  // Pass 2: import/render/use edges + api calls.
  const apiCalls: ResolvedApiCall[] = [];
  for (const facts of factsByFile) {
    const { rel } = facts;
    const inPage = isPageFile(rel);
    const fileId = nodeId("File", rel);

    // Local symbol table: same-file declarations + resolved imports.
    const local = new Map<string, SymbolRef>();
    for (const d of facts.decls) {
      const kind = declNodeKind(d.rawKind, d.isDefaultExport, inPage);
      local.set(d.name, { id: nodeId(kind, rel, d.name), kind });
    }
    for (const t of facts.types) {
      local.set(t.name, { id: nodeId("Type", rel, t.name), kind: "Type" });
    }
    for (const c of facts.contexts) {
      local.set(c.name, { id: nodeId("Context", rel, c.name), kind: "Context" });
    }

    for (const imp of facts.imports) {
      const targetRel = resolveModule(rel, imp.specifier);
      if (!targetRel) continue; // external / unresolved / outside scan
      addEdge("IMPORTS", fileId, nodeId("File", targetRel));
      const targetExports = exportsByFile.get(targetRel);
      if (!targetExports) continue;
      if (imp.defaultName) {
        const ref = targetExports.get("default");
        if (ref) local.set(imp.defaultName, ref);
      }
      for (const ni of imp.named) {
        const ref = targetExports.get(ni.name);
        if (ref) local.set(ni.alias ?? ni.name, ref);
      }
    }

    // Dynamic imports (`import()`, next/dynamic, React.lazy) — file IMPORTS edge,
    // and bind the local name to the target's default export (like a default import).
    for (const di of facts.dynamicImports) {
      const targetRel = resolveModule(rel, di.source);
      if (!targetRel) continue;
      addEdge("IMPORTS", fileId, nodeId("File", targetRel));
      if (di.localName) {
        const ref = exportsByFile.get(targetRel)?.get("default");
        if (ref) local.set(di.localName, ref);
      }
    }

    for (const t of facts.types) {
      const fromId = nodeId("Type", rel, t.name);
      for (const name of t.typeNames) {
        const ref = local.get(name);
        if (ref?.kind === "Type" && ref.id !== fromId) addEdge("TYPES", fromId, ref.id);
      }
    }

    for (const d of facts.decls) {
      const fromKind = declNodeKind(d.rawKind, d.isDefaultExport, inPage);
      const fromId = nodeId(fromKind, rel, d.name);

      for (const tag of d.jsxTags) {
        const ref = local.get(tag);
        if (ref && (ref.kind === "Component" || ref.kind === "Page")) {
          addEdge("RENDERS", fromId, ref.id);
        }
      }

      for (const name of d.hookCallNames) {
        const ref = local.get(name);
        if (ref && ref.kind === "Hook") addEdge("USES", fromId, ref.id);
      }

      for (const name of d.functionCallNames) {
        const ref = local.get(name);
        if (ref && ref.kind === "Function" && ref.id !== fromId) {
          addEdge("CALLS", fromId, ref.id, "high");
        }
      }

      for (const name of d.typeNames) {
        const ref = local.get(name);
        if (ref?.kind === "Type") addEdge("TYPES", fromId, ref.id);
      }

      for (const name of d.contextProviders) {
        const ref = local.get(name);
        if (ref?.kind === "Context") addEdge("PROVIDES", fromId, ref.id);
      }

      for (const name of d.contextReads) {
        const ref = local.get(name);
        if (ref?.kind === "Context") addEdge("CONSUMES", fromId, ref.id);
      }

      for (const ac of d.apiCalls) {
        apiCalls.push({
          ...ac,
          file: rel,
          callerId: fromId,
          fullUrl: joinUrl(axiosClients[ac.client], ac.url),
        });
      }
    }

    for (const ac of facts.fileApiCalls) {
      apiCalls.push({
        ...ac,
        file: rel,
        callerId: fileId,
        fullUrl: joinUrl(axiosClients[ac.client], ac.url),
      });
    }
  }

  return { nodes, edges, apiCalls };
}
