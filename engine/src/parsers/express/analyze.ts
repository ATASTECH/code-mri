import { readFileSync } from "node:fs";
import * as path from "node:path";
import {
  Node,
  Project,
  SyntaxKind,
  ts,
  type CallExpression,
  type Expression,
  type Node as MorphNode,
  type SourceFile,
} from "ts-morph";
import type { GraphEdge, GraphNode, NodeKind } from "@code-mri/shared-types";
import { edgeId, nodeId } from "../../ids.js";
import type { BackendRoute } from "../py/assemble.js";
import { extractDeclarations } from "../ts/declarations.js";
import { createModuleResolver } from "../ts/resolveModule.js";
import { readTsResolverConfig } from "../ts/tsconfig.js";

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);

export interface ExpressAnalysis {
  nodes: GraphNode[];
  edges: GraphEdge[];
  routes: BackendRoute[];
}

interface RouterFact {
  name: string;
  line: number;
  isApp: boolean;
  isExported: boolean;
  isDefaultExport: boolean;
  exportNames: string[];
}

interface ImportFact {
  specifier: string;
  defaultName?: string;
  named: { name: string; alias?: string }[];
}

interface HandlerRef {
  id: string;
  kind: NodeKind;
}

interface RouteFact {
  routerName: string;
  method: string;
  path: string;
  line: number;
  handlerNames: string[];
}

interface UseFact {
  routerName: string;
  path: string;
  line: number;
  argNames: string[];
}

interface ExpressFileFacts {
  rel: string;
  routers: RouterFact[];
  imports: ImportFact[];
  handlers: Map<string, HandlerRef>;
  routes: RouteFact[];
  uses: UseFact[];
}

interface RouterRef {
  id: string;
  name: string;
  rel: string;
  isApp: boolean;
}

interface MountedRouter {
  parent: RouterRef;
  child: RouterRef;
  path: string;
}

interface RegisteredRoute extends RouteFact {
  router: RouterRef;
  handlers: HandlerRef[];
}

interface RegisteredUse extends UseFact {
  router: RouterRef;
  handlers: HandlerRef[];
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
  const path = value.trim() || "/";
  const withLeadingSlash = path.startsWith("/") ? path : `/${path}`;
  const normalized = withLeadingSlash
    .replace(/\/+/g, "/")
    .replace(/:([A-Za-z_$][\w$]*)/g, "{$1}");
  return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
}

function joinPaths(base: string, child: string): string {
  if (base === "/" || base === "") return cleanPath(child);
  if (child === "/" || child === "") return cleanPath(base);
  return cleanPath(`${base.replace(/\/+$/, "")}/${child.replace(/^\/+/, "")}`);
}

function stringArg(arg: MorphNode | undefined): string | null {
  if (!arg) return null;
  if (Node.isStringLiteral(arg)) return arg.getLiteralValue();
  if (Node.isNoSubstitutionTemplateLiteral(arg)) return arg.getLiteralText();
  return null;
}

function identifierName(node: MorphNode | undefined): string | null {
  if (!node) return null;
  if (Node.isIdentifier(node)) return node.getText();
  return null;
}

function collectIdentifierArgs(args: MorphNode[]): string[] {
  const names: string[] = [];
  for (const arg of args) {
    const direct = identifierName(arg);
    if (direct) {
      names.push(direct);
      continue;
    }
    if (Node.isArrayLiteralExpression(arg)) {
      for (const item of arg.getElements()) {
        const nested = identifierName(item);
        if (nested) names.push(nested);
      }
    }
  }
  return names;
}

function isExpressAppInitializer(init: Expression): boolean {
  return Node.isCallExpression(init) && init.getExpression().getText() === "express";
}

function isExpressRouterInitializer(init: Expression): boolean {
  if (!Node.isCallExpression(init)) return false;
  const text = init.getExpression().getText();
  return text === "Router" || text === "express.Router";
}

function routerInitKind(init: Expression | undefined): "app" | "router" | null {
  if (!init) return null;
  if (isExpressAppInitializer(init)) return "app";
  if (isExpressRouterInitializer(init)) return "router";
  return null;
}

function routeFromCall(call: CallExpression): RouteFact | null {
  const expr = call.getExpression();
  if (!Node.isPropertyAccessExpression(expr)) return null;

  const method = expr.getName().toLowerCase();
  if (!HTTP_METHODS.has(method)) return null;

  const target = expr.getExpression();
  const args = call.getArguments();

  if (Node.isIdentifier(target)) {
    const routePath = stringArg(args[0]);
    if (!routePath) return null;
    return {
      routerName: target.getText(),
      method: method.toUpperCase(),
      path: cleanPath(routePath),
      line: call.getStartLineNumber(),
      handlerNames: collectIdentifierArgs(args.slice(1)),
    };
  }

  if (Node.isCallExpression(target)) {
    const routeExpr = target.getExpression();
    if (!Node.isPropertyAccessExpression(routeExpr)) return null;
    if (routeExpr.getName() !== "route") return null;
    const routerName = identifierName(routeExpr.getExpression());
    const routePath = stringArg(target.getArguments()[0]);
    if (!routerName || !routePath) return null;
    return {
      routerName,
      method: method.toUpperCase(),
      path: cleanPath(routePath),
      line: call.getStartLineNumber(),
      handlerNames: collectIdentifierArgs(args),
    };
  }

  return null;
}

function useFromCall(call: CallExpression): UseFact | null {
  const expr = call.getExpression();
  if (!Node.isPropertyAccessExpression(expr)) return null;
  if (expr.getName() !== "use") return null;
  const routerName = identifierName(expr.getExpression());
  if (!routerName) return null;

  const args = call.getArguments();
  const firstPath = stringArg(args[0]);
  const routePath = cleanPath(firstPath ?? "/");
  const rest = firstPath ? args.slice(1) : args;
  const argNames = collectIdentifierArgs(rest);
  if (argNames.length === 0) return null;

  return {
    routerName,
    path: routePath,
    line: call.getStartLineNumber(),
    argNames,
  };
}

function extractExpressFacts(sf: SourceFile, rel: string): ExpressFileFacts {
  const routers: RouterFact[] = [];
  const routerByName = new Map<string, RouterFact>();

  for (const stmt of sf.getVariableStatements()) {
    const exported = stmt.isExported();
    for (const decl of stmt.getDeclarations()) {
      const initKind = routerInitKind(decl.getInitializer());
      if (!initKind) continue;
      const name = decl.getName();
      const fact: RouterFact = {
        name,
        line: decl.getStartLineNumber(),
        isApp: initKind === "app",
        isExported: exported,
        isDefaultExport: false,
        exportNames: exported ? [name] : [],
      };
      routers.push(fact);
      routerByName.set(name, fact);
    }
  }

  for (const assignment of sf.getExportAssignments()) {
    const name = identifierName(assignment.getExpression());
    const router = name ? routerByName.get(name) : undefined;
    if (!router) continue;
    router.isExported = true;
    router.isDefaultExport = true;
  }

  for (const ed of sf.getExportDeclarations()) {
    if (ed.getModuleSpecifierValue()) continue;
    for (const ne of ed.getNamedExports()) {
      const name = ne.getName();
      const router = routerByName.get(name);
      if (!router) continue;
      router.isExported = true;
      router.exportNames.push(ne.getAliasNode()?.getText() ?? name);
    }
  }

  const handlers = new Map<string, HandlerRef>();
  for (const decl of extractDeclarations(sf)) {
    handlers.set(decl.name, {
      id: nodeId(decl.kind, rel, decl.name),
      kind: decl.kind,
    });
  }

  const routes: RouteFact[] = [];
  const uses: UseFact[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const route = routeFromCall(call);
    if (route) routes.push(route);
    const use = useFromCall(call);
    if (use) uses.push(use);
  }

  return {
    rel,
    routers,
    imports: sf.getImportDeclarations().map((imp) => ({
      specifier: imp.getModuleSpecifierValue(),
      defaultName: imp.getDefaultImport()?.getText(),
      named: imp.getNamedImports().map((ni) => ({
        name: ni.getName(),
        alias: ni.getAliasNode()?.getText(),
      })),
    })),
    handlers,
    routes,
    uses,
  };
}

function routerRef(fact: ExpressFileFacts, router: RouterFact): RouterRef {
  return {
    id: nodeId("Service", fact.rel, router.name),
    name: router.name,
    rel: fact.rel,
    isApp: router.isApp,
  };
}

function addUnique<T extends { id: string }>(items: T[], seen: Set<string>, item: T) {
  if (seen.has(item.id)) return;
  seen.add(item.id);
  items.push(item);
}

function routeNodeId(rel: string, method: string, routePath: string): string {
  return nodeId("Route", rel, `${method} ${routePath}`);
}

/** Analyze Express apps/routers in TS/JS files and emit backend routes. */
export function analyzeExpress(
  root: string,
  files: { path: string; abs: string }[],
): ExpressAnalysis {
  const project = createTsProject();
  const facts = files.map((file) => {
    const text = readFileSync(path.resolve(file.abs), "utf8");
    const sf = project.createSourceFile(path.resolve(file.abs), text, { overwrite: true });
    return extractExpressFacts(sf, file.path);
  });

  const resolveModule = createModuleResolver({
    files: files.map((file) => file.path),
    ...readTsResolverConfig(root),
  });

  const localRoutersByFile = new Map<string, Map<string, RouterRef>>();
  const routerExportsByFile = new Map<string, Map<string, RouterRef>>();
  const allRouters = new Map<string, RouterRef>();

  for (const fact of facts) {
    const local = new Map<string, RouterRef>();
    const exports = new Map<string, RouterRef>();
    for (const router of fact.routers) {
      const ref = routerRef(fact, router);
      local.set(router.name, ref);
      allRouters.set(ref.id, ref);
      for (const exportName of router.exportNames) exports.set(exportName, ref);
      if (router.isDefaultExport) exports.set("default", ref);
    }
    localRoutersByFile.set(fact.rel, local);
    routerExportsByFile.set(fact.rel, exports);
  }

  for (const fact of facts) {
    const local = localRoutersByFile.get(fact.rel);
    if (!local) continue;
    for (const imp of fact.imports) {
      const targetRel = resolveModule(fact.rel, imp.specifier);
      if (!targetRel) continue;
      const targetExports = routerExportsByFile.get(targetRel);
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
  }

  const registeredRoutes: RegisteredRoute[] = [];
  const registeredUses: RegisteredUse[] = [];
  const mounts: MountedRouter[] = [];

  for (const fact of facts) {
    const localRouters = localRoutersByFile.get(fact.rel) ?? new Map();
    const handlers = fact.handlers;

    for (const route of fact.routes) {
      const router = localRouters.get(route.routerName);
      if (!router) continue;
      registeredRoutes.push({
        ...route,
        router,
        handlers: route.handlerNames
          .map((name) => handlers.get(name))
          .filter((ref): ref is HandlerRef => !!ref),
      });
    }

    for (const use of fact.uses) {
      const parent = localRouters.get(use.routerName);
      if (!parent) continue;
      const child = use.argNames.map((name) => localRouters.get(name)).find(Boolean);
      if (child) {
        mounts.push({ parent, child, path: use.path });
      }
      const middleware = use.argNames
        .filter((name) => localRouters.get(name) !== child)
        .map((name) => handlers.get(name))
        .filter((ref): ref is HandlerRef => !!ref);
      if (middleware.length > 0) {
        registeredUses.push({ ...use, router: parent, handlers: middleware });
      }
    }
  }

  const prefixes = new Map<string, Set<string>>();
  const addPrefix = (router: RouterRef, prefix: string): boolean => {
    const set = prefixes.get(router.id) ?? new Set<string>();
    const normalized = cleanPath(prefix || "/");
    const size = set.size;
    set.add(normalized);
    prefixes.set(router.id, set);
    return set.size !== size;
  };

  for (const router of allRouters.values()) {
    if (router.isApp) addPrefix(router, "/");
  }
  for (let guard = 0; guard < 10; guard++) {
    let changed = false;
    for (const mount of mounts) {
      for (const prefix of prefixes.get(mount.parent.id) ?? []) {
        changed = addPrefix(mount.child, joinPaths(prefix, mount.path)) || changed;
      }
    }
    if (!changed) break;
  }
  for (const router of allRouters.values()) {
    if (!prefixes.has(router.id)) addPrefix(router, "/");
  }

  const nodes: GraphNode[] = [];
  const nodeIndex = new Set<string>();
  const edges: GraphEdge[] = [];
  const edgeIndex = new Set<string>();
  const routes: BackendRoute[] = [];

  const addNode = (node: GraphNode) => addUnique(nodes, nodeIndex, node);
  const addEdge = (kind: GraphEdge["kind"], from: string, to: string) => {
    const id = edgeId(kind, from, to);
    if (edgeIndex.has(id)) return;
    edgeIndex.add(id);
    edges.push({ id, from, to, kind });
  };

  for (const fact of facts) {
    for (const router of fact.routers) {
      const ref = routerRef(fact, router);
      addNode({
        id: ref.id,
        kind: "Service",
        name: router.name,
        loc: { file: fact.rel, line: router.line },
        meta: {
          framework: "express",
          type: router.isApp ? "app" : "router",
          exported: router.isExported,
        },
      });
    }
  }

  for (const mount of mounts) {
    addEdge("REGISTERED_IN", mount.child.id, mount.parent.id);
  }

  for (const route of registeredUses) {
    for (const prefix of prefixes.get(route.router.id) ?? ["/"]) {
      const fullPath = joinPaths(prefix, route.path);
      const id = routeNodeId(route.router.rel, "USE", fullPath);
      addNode({
        id,
        kind: "Route",
        name: `USE ${fullPath}`,
        loc: { file: route.router.rel, line: route.line },
        meta: {
          framework: "express",
          method: "USE",
          path: fullPath,
          middleware: true,
        },
      });
      addEdge("REGISTERED_IN", id, route.router.id);
      for (const handler of route.handlers) addEdge("USES", id, handler.id);
    }
  }

  for (const route of registeredRoutes) {
    for (const prefix of prefixes.get(route.router.id) ?? ["/"]) {
      const fullPath = joinPaths(prefix, route.path);
      const routeId = routeNodeId(route.router.rel, route.method, fullPath);
      const endpointId = nodeId("APIEndpoint", `${route.method} ${fullPath}`);

      addNode({
        id: routeId,
        kind: "Route",
        name: `${route.method} ${fullPath}`,
        loc: { file: route.router.rel, line: route.line },
        meta: {
          framework: "express",
          method: route.method,
          path: fullPath,
          router: route.router.name,
        },
      });
      addNode({
        id: endpointId,
        kind: "APIEndpoint",
        name: `${route.method} ${fullPath}`,
        meta: { method: route.method, path: fullPath, source: "express" },
      });
      addEdge("REGISTERED_IN", routeId, route.router.id);
      addEdge("EXPOSES", routeId, endpointId);
      for (const handler of route.handlers) addEdge("USES", routeId, handler.id);
      routes.push({
        method: route.method,
        path: fullPath,
        viewsetId: routeId,
        endpointId,
      });
    }
  }

  return { nodes, edges, routes };
}
