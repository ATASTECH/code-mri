import { readFileSync } from "node:fs";
import * as path from "node:path";
import {
  type JsxElement,
  type JsxSelfClosingElement,
  Node,
  Project,
  type SourceFile,
  ts,
} from "ts-morph";
import type { GraphEdge, GraphNode } from "@code-mri/shared-types";
import { edgeId, nodeId } from "../../ids.js";
import type { BackendRoute } from "../py/assemble.js";
import { extractDeclarations } from "../ts/declarations.js";

export interface ReactRouterAnalysis {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** react-router routes are frontend page routes, not backend API routes. */
  routes: BackendRoute[];
}

const ENTRY_CANDIDATES = [
  "src/main.tsx",
  "src/main.jsx",
  "src/index.tsx",
  "src/index.jsx",
  "src/main.ts",
  "src/index.ts",
  "main.tsx",
  "index.tsx",
];

/** Best-guess SPA entry point among the scanned files (Vite/CRA conventions). */
export function findEntryPoint(files: string[]): string | null {
  const set = new Set(files);
  return ENTRY_CANDIDATES.find((c) => set.has(c)) ?? null;
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

function cleanPath(value: string): string {
  const raw = value.trim() || "/";
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  const normalized = withSlash.replace(/\/+/g, "/").replace(/:([A-Za-z_$][\w$]*)/g, "{$1}");
  return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
}

function joinPaths(base: string, child: string): string {
  if (base === "/" || base === "") return cleanPath(child);
  if (child === "/" || child === "") return cleanPath(base);
  return cleanPath(`${base.replace(/\/+$/, "")}/${child.replace(/^\/+/, "")}`);
}

type JsxTag = JsxSelfClosingElement | JsxElement;

function tagName(node: JsxTag): string {
  if (Node.isJsxSelfClosingElement(node)) return node.getTagNameNode().getText();
  return node.getOpeningElement().getTagNameNode().getText();
}

function attribute(node: JsxTag, name: string) {
  if (Node.isJsxSelfClosingElement(node)) return node.getAttribute(name);
  return node.getOpeningElement().getAttribute(name);
}

function isRoute(node: Node): node is JsxTag {
  return (
    (Node.isJsxSelfClosingElement(node) || Node.isJsxElement(node)) && tagName(node) === "Route"
  );
}

/** Own `path=` of a <Route>, or null when it has none (e.g. an index route). */
function routePath(node: JsxTag): string | null {
  const attr = attribute(node, "path");
  if (!attr || !Node.isJsxAttribute(attr)) return null;
  const init = attr.getInitializer();
  if (init && Node.isStringLiteral(init)) return init.getLiteralValue();
  return null;
}

/** Component name from `element={<Comp/>}`, or null. */
function routeComponent(node: JsxTag): string | null {
  const attr = attribute(node, "element");
  if (!attr || !Node.isJsxAttribute(attr)) return null;
  const init = attr.getInitializer();
  if (!init || !Node.isJsxExpression(init)) return null;
  const expr = init.getExpression();
  if (!expr) return null;
  if (Node.isJsxSelfClosingElement(expr)) return expr.getTagNameNode().getText();
  if (Node.isJsxElement(expr)) return expr.getOpeningElement().getTagNameNode().getText();
  return null;
}

/** Full path of a <Route>, joining the paths of its ancestor <Route> elements. */
function fullRoutePath(node: JsxTag): string {
  const segments: string[] = [];
  for (const ancestor of node.getAncestors()) {
    if (isRoute(ancestor)) {
      const p = routePath(ancestor);
      if (p !== null) segments.unshift(p);
    }
  }
  const own = routePath(node);
  if (own !== null) segments.push(own);
  return segments.reduce((acc, seg) => joinPaths(acc, seg), "/");
}

/**
 * Detect react-router `<Route path element={<Page/>}>` declarations across a
 * Vite/CRA project and map each to the page component it renders.
 */
export function analyzeReactRouter(
  _root: string,
  files: { path: string; abs: string }[],
): ReactRouterAnalysis {
  const project = createTsProject();
  const sources: { sf: SourceFile; rel: string }[] = files.map((file) => {
    const text = readFileSync(path.resolve(file.abs), "utf8");
    const sf = project.createSourceFile(path.resolve(file.abs), text, { overwrite: true });
    return { sf, rel: file.path };
  });

  // name -> component node id (matches analyzeTypeScript's Component/Page nodes).
  const componentId = new Map<string, string>();
  for (const { sf, rel } of sources) {
    for (const decl of extractDeclarations(sf)) {
      if (decl.kind === "Component") {
        componentId.set(decl.name, nodeId(decl.kind, rel, decl.name));
      }
    }
  }

  const nodes: GraphNode[] = [];
  const nodeIndex = new Set<string>();
  const edges: GraphEdge[] = [];
  const edgeIndex = new Set<string>();
  const addNode = (node: GraphNode) => {
    if (nodeIndex.has(node.id)) return;
    nodeIndex.add(node.id);
    nodes.push(node);
  };
  const addEdge = (kind: GraphEdge["kind"], from: string, to: string) => {
    const id = edgeId(kind, from, to);
    if (edgeIndex.has(id)) return;
    edgeIndex.add(id);
    edges.push({ id, from, to, kind });
  };

  for (const { sf, rel } of sources) {
    for (const node of sf.getDescendants()) {
      if (!isRoute(node)) continue;
      if (routePath(node) === null) continue;
      const full = fullRoutePath(node);
      const routeId = nodeId("Route", rel, `PAGE ${full}`);
      addNode({
        id: routeId,
        kind: "Route",
        name: `PAGE ${full}`,
        loc: { file: rel, line: node.getStartLineNumber() },
        meta: { framework: "react-router", path: full, type: "page" },
      });
      const compName = routeComponent(node);
      const compId = compName ? componentId.get(compName) : undefined;
      if (compId) addEdge("RENDERS", routeId, compId);
    }
  }

  return { nodes, edges, routes: [] };
}
