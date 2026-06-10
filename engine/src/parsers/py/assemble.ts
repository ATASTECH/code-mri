import type { GraphEdge, GraphNode, NodeKind } from "@code-mri/shared-types";
import { edgeId, nodeId } from "../../ids.js";

// ---------------------------------------------------------------------------
// Fact shapes (mirror the Python sidecar's JSON output)
// ---------------------------------------------------------------------------

export interface PyField {
  name: string;
  type: string;
  line: number;
  options: Record<string, unknown>;
}
export interface PyModel {
  file: string;
  name: string;
  line: number;
  fields: PyField[];
  managers?: PyModelManager[];
}
export interface PyModelManager {
  name: string;
  manager: string;
  line: number;
}
export interface PyManager {
  file: string;
  name: string;
  line: number;
}
export interface PySignalReceiver {
  file: string;
  name: string;
  line: number;
  signal: string;
  sender: string | null;
}
export interface PyQuerySetUse {
  file: string;
  owner: string;
  owner_kind: "function" | "view" | "manager";
  model: string;
  method: string;
  line: number;
}
export interface PyImport {
  file: string;
  module: string;
  name: string | null;
  alias: string;
  line: number;
}
export interface PyFunction {
  file: string;
  name: string;
  line: number;
  owner: string | null;
  owner_kind: "module" | "class" | "view" | "manager";
}
export interface PyFunctionCall {
  file: string;
  caller: string;
  target: string;
  target_module: string | null;
  line: number;
}
export interface PyNestedSerializerField {
  field: string;
  serializer: string;
}
export interface PySerializerDeclaredField {
  name: string;
  source?: string | null;
  kind?: "field" | "method";
}
export interface PySerializer {
  file: string;
  name: string;
  line: number;
  model: string | null;
  fields: string[] | "__all__" | null;
  declared_fields?: PySerializerDeclaredField[];
  /** Fields whose value is another serializer (DRF nested serializers). */
  nested?: PyNestedSerializerField[];
}
export interface PyView {
  file: string;
  name: string;
  line: number;
  is_model_viewset: boolean;
  serializer_class: string | null;
  queryset_model: string | null;
}
export interface PyRegistration {
  file: string;
  prefix: string;
  viewset: string;
  basename: string | null;
  /** Variable name of the router the viewset was registered on. */
  router?: string;
}
/** A drf-nested-routers NestedSimpleRouter/NestedDefaultRouter declaration. */
export interface PyNestedRouter {
  file: string;
  /** Variable name of the nested router. */
  name: string;
  /** Variable name of the parent router. */
  parent: string;
  /** Parent registered prefix this nests under (2nd positional arg). */
  parent_prefix: string;
  /** `lookup=` kwarg; the URL kwarg becomes `<lookup>_pk`. */
  lookup: string;
}
export interface PyInclude {
  file: string;
  prefix: string;
  module: string;
}
export interface PyCeleryTask {
  file: string;
  name: string;
  line: number;
}

/** A FastAPI app/`APIRouter` or Flask app/`Blueprint` bound to a variable. */
export interface PyHttpRouter {
  file: string;
  name: string;
  framework: "fastapi" | "flask";
  kind: "app" | "router";
  /** Own prefix from `APIRouter(prefix=...)` / `Blueprint(url_prefix=...)`, else "". */
  prefix: string;
}
/** A route declared via decorator: `@router.get("/x")` / `@app.route("/x")`. */
export interface PyHttpRoute {
  file: string;
  /** Variable name the decorator was applied on. */
  router: string;
  method: string;
  path: string;
  handler: string;
  line: number;
  response_model?: string | null;
}
/** A mount: `app.include_router(r, prefix=...)` / `app.register_blueprint(bp, url_prefix=...)`. */
export interface PyHttpMount {
  file: string;
  parent: string;
  child: string;
  prefix: string;
}

export interface PyFacts {
  base_dir: string;
  root_urlconf: string | null;
  models: PyModel[];
  managers?: PyManager[];
  signals?: PySignalReceiver[];
  queryset_uses?: PyQuerySetUse[];
  imports?: PyImport[];
  functions?: PyFunction[];
  function_calls?: PyFunctionCall[];
  serializers: PySerializer[];
  views: PyView[];
  registrations: PyRegistration[];
  includes: PyInclude[];
  celery_tasks: PyCeleryTask[];
  /** drf-nested-routers declarations (optional). */
  nested_routers?: PyNestedRouter[];
  /** FastAPI/Flask facts (optional - absent for pure Django bundles). */
  http_routers?: PyHttpRouter[];
  http_routes?: PyHttpRoute[];
  http_mounts?: PyHttpMount[];
}

export interface BackendRoute {
  method: string;
  /** Canonical path, e.g. "/api/users/" or "/api/users/{id}/". */
  path: string;
  viewsetId: string | null;
  endpointId: string;
  responseFields?: Array<{ id: string; name: string }>;
}

export interface PyAnalysis {
  nodes: GraphNode[];
  edges: GraphEdge[];
  routes: BackendRoute[];
}

// ---------------------------------------------------------------------------

function normPath(p: string): string {
  return `/${p}`.replace(/\/{2,}/g, "/");
}

function normalizeFilePath(file: string): string {
  return file.replace(/\\/g, "/").replace(/^\.\//, "");
}

function dirname(file: string): string {
  const normalized = normalizeFilePath(file);
  const index = normalized.lastIndexOf("/");
  return index === -1 ? "" : normalized.slice(0, index);
}

function stripPy(file: string): string {
  return file.endsWith(".py") ? file.slice(0, -3) : file;
}

function moduleFromFile(file: string): string {
  const stem = stripPy(normalizeFilePath(file));
  return stem.endsWith("/__init__")
    ? stem.slice(0, -"/__init__".length).replace(/\//g, ".")
    : stem.replace(/\//g, ".");
}

function resolvePythonModule(module: string, files: Set<string>, baseDir: string): string | null {
  const candidates = [
    `${module.replace(/\./g, "/")}.py`,
    `${module.replace(/\./g, "/")}/__init__.py`,
  ];
  if (baseDir) {
    candidates.push(
      `${baseDir}/${module.replace(/\./g, "/")}.py`,
      `${baseDir}/${module.replace(/\./g, "/")}/__init__.py`,
    );
  }
  for (const candidate of candidates.map(normalizeFilePath)) {
    if (files.has(candidate)) return candidate;
  }
  return null;
}

function resolveRelativePythonModule(fromFile: string, module: string, files: Set<string>): string | null {
  const dir = dirname(fromFile);
  const candidate = normalizeFilePath(`${dir}/${module.replace(/\./g, "/")}.py`);
  if (files.has(candidate)) return candidate;
  const packageCandidate = normalizeFilePath(`${dir}/${module.replace(/\./g, "/")}/__init__.py`);
  return files.has(packageCandidate) ? packageCandidate : null;
}

/** Flask `<int:id>` / `<id>` and FastAPI `{id}` both -> `{id}`. */
function normParams(p: string): string {
  return p.replace(/<(?:[^:>]+:)?([^>]+)>/g, "{$1}");
}

/** Normalize an HTTP route segment: leading slash, collapse `//`, no trailing slash. */
function cleanHttpPath(value: string): string {
  const raw = normParams(value.trim() || "/");
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  const normalized = withSlash.replace(/\/+/g, "/");
  return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
}

function joinHttpPaths(base: string, child: string): string {
  if (base === "/" || base === "") return cleanHttpPath(child);
  if (child === "/" || child === "") return cleanHttpPath(base);
  return cleanHttpPath(`${base.replace(/\/+$/, "")}/${child.replace(/^\/+/, "")}`);
}

interface HttpGraphCtx {
  addNode: (n: GraphNode) => void;
  addEdge: (kind: GraphEdge["kind"], from: string, to: string) => void;
  routes: BackendRoute[];
  responseFieldsForModel: (model: string | null | undefined) => Array<{ id: string; name: string }>;
}

/** Resolve FastAPI/Flask routers, mounts and routes into graph nodes/edges + routes. */
function appendHttpRoutes(facts: PyFacts, ctx: HttpGraphCtx): void {
  const routers = facts.http_routers ?? [];
  if (routers.length === 0) return;
  const httpRoutes = facts.http_routes ?? [];
  const mounts = facts.http_mounts ?? [];

  const key = (file: string, name: string) => `${file}::${name}`;
  const routerByKey = new Map<string, PyHttpRouter>();
  const keysByName = new Map<string, string[]>();
  for (const r of routers) {
    const k = key(r.file, r.name);
    routerByKey.set(k, r);
    keysByName.set(r.name, [...(keysByName.get(r.name) ?? []), k]);
  }

  // Resolve a referenced router by variable name: same file first, else unique global.
  const resolve = (file: string, name: string): string | null => {
    const same = key(file, name);
    if (routerByKey.has(same)) return same;
    const candidates = keysByName.get(name) ?? [];
    return candidates.length === 1 ? (candidates[0] as string) : null;
  };

  const resolvedMounts = mounts
    .map((m) => {
      const parent = resolve(m.file, m.parent);
      const child = resolve(m.file, m.child);
      return parent && child ? { parent, child, prefix: cleanHttpPath(m.prefix || "/") } : null;
    })
    .filter((x): x is { parent: string; child: string; prefix: string } => x !== null);
  const mountedChildren = new Set(resolvedMounts.map((m) => m.child));

  // Effective prefixes: apps + unmounted routers seed with their own prefix;
  // mounted routers inherit parentPrefix + mountPrefix + ownPrefix (fixpoint).
  const prefixes = new Map<string, Set<string>>();
  const addPrefix = (k: string, p: string): boolean => {
    const set = prefixes.get(k) ?? new Set<string>();
    const before = set.size;
    set.add(p);
    prefixes.set(k, set);
    return set.size !== before;
  };
  for (const [k, r] of routerByKey) {
    if (r.kind === "app" || !mountedChildren.has(k)) addPrefix(k, cleanHttpPath(r.prefix || "/"));
  }
  for (let guard = 0; guard < 20; guard++) {
    let changed = false;
    for (const m of resolvedMounts) {
      const childOwn = cleanHttpPath(routerByKey.get(m.child)?.prefix || "/");
      for (const p of prefixes.get(m.parent) ?? []) {
        changed = addPrefix(m.child, joinHttpPaths(joinHttpPaths(p, m.prefix), childOwn)) || changed;
      }
    }
    if (!changed) break;
  }

  for (const [, r] of routerByKey) {
    ctx.addNode({
      id: nodeId("Service", r.file, r.name),
      kind: "Service",
      name: r.name,
      loc: { file: r.file },
      meta: { framework: r.framework, type: r.kind },
    });
  }
  for (const m of resolvedMounts) {
    const child = routerByKey.get(m.child) as PyHttpRouter;
    const parent = routerByKey.get(m.parent) as PyHttpRouter;
    ctx.addEdge(
      "REGISTERED_IN",
      nodeId("Service", child.file, child.name),
      nodeId("Service", parent.file, parent.name),
    );
  }

  for (const route of httpRoutes) {
    const k = resolve(route.file, route.router);
    if (!k) continue;
    const r = routerByKey.get(k) as PyHttpRouter;
    const routerServiceId = nodeId("Service", r.file, r.name);
    const handlerId = nodeId("Function", route.file, route.handler);
    ctx.addNode({
      id: handlerId,
      kind: "Function",
      name: route.handler,
      loc: { file: route.file, line: route.line },
    });
    for (const prefix of prefixes.get(k) ?? [cleanHttpPath(r.prefix || "/")]) {
      const fullPath = joinHttpPaths(prefix, route.path);
      const routeId = nodeId("Route", route.file, `${route.method} ${fullPath}`);
      const endpointId = nodeId("APIEndpoint", `${route.method} ${fullPath}`);
      ctx.addNode({
        id: routeId,
        kind: "Route",
        name: `${route.method} ${fullPath}`,
        loc: { file: route.file, line: route.line },
        meta: { framework: r.framework, method: route.method, path: fullPath },
      });
      ctx.addNode({
        id: endpointId,
        kind: "APIEndpoint",
        name: `${route.method} ${fullPath}`,
        meta: { method: route.method, path: fullPath, source: r.framework },
      });
      ctx.addEdge("REGISTERED_IN", routeId, routerServiceId);
      ctx.addEdge("EXPOSES", routeId, endpointId);
      ctx.addEdge("USES", routeId, handlerId);
      ctx.routes.push({
        method: route.method,
        path: fullPath,
        viewsetId: routeId,
        endpointId,
        responseFields: ctx.responseFieldsForModel(route.response_model),
      });
    }
  }
}

/** Resolve a Django dotted module to a repo-relative file path. */
function moduleToFile(module: string, baseDir: string): string {
  const rel = `${module.split(".").join("/")}.py`;
  return baseDir ? `${baseDir}/${rel}` : rel;
}

/**
 * Compute, for each urls file, the list of path prefixes it is mounted under,
 * by walking include() edges from the root URLconf.
 */
function computeMounts(facts: PyFacts): Map<string, string[]> {
  const mounts = new Map<string, string[]>();
  const rootFile = facts.root_urlconf
    ? moduleToFile(facts.root_urlconf, facts.base_dir)
    : null;
  if (!rootFile) return mounts;

  mounts.set(rootFile, [""]);
  const queue = [rootFile];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (visited.has(file)) continue;
    visited.add(file);
    const parents = mounts.get(file) ?? [""];
    for (const inc of facts.includes.filter((i) => i.file === file)) {
      const child = moduleToFile(inc.module, facts.base_dir);
      const next = parents.map((p) => p + inc.prefix);
      mounts.set(child, [...(mounts.get(child) ?? []), ...next]);
      queue.push(child);
    }
  }
  return mounts;
}

function routerPrefixMap(facts: PyFacts): Map<string, string[]> {
  const byRouter = new Map<string, PyRegistration[]>();
  for (const reg of facts.registrations) {
    const router = reg.router ?? "";
    byRouter.set(router, [...(byRouter.get(router) ?? []), reg]);
  }

  const nestedByName = new Map<string, PyNestedRouter>();
  for (const nested of facts.nested_routers ?? []) nestedByName.set(nested.name, nested);

  const cache = new Map<string, string[]>();
  const resolve = (router: string, stack = new Set<string>()): string[] => {
    if (cache.has(router)) return cache.get(router) as string[];
    const nested = nestedByName.get(router);
    if (!nested || stack.has(router)) {
      cache.set(router, [""]);
      return [""];
    }

    const nextStack = new Set(stack);
    nextStack.add(router);
    const parentPrefixes = resolve(nested.parent, nextStack);
    const parentRegistrations = byRouter.get(nested.parent) ?? [];
    const registeredParent = parentRegistrations.find((r) => r.prefix === nested.parent_prefix);
    const parentPrefix = registeredParent?.prefix ?? nested.parent_prefix;
    const prefixes = parentPrefixes.map(
      (prefix) => `${prefix}${parentPrefix}/{${nested.lookup}_pk}/`,
    );
    cache.set(router, prefixes);
    return prefixes;
  };

  const routers = new Set<string>();
  for (const reg of facts.registrations) routers.add(reg.router ?? "");
  for (const nested of facts.nested_routers ?? []) {
    routers.add(nested.name);
    routers.add(nested.parent);
  }
  for (const router of routers) resolve(router);

  return cache;
}

/** Turn Django facts into graph nodes/edges and canonical API routes. */
export function buildBackendGraph(facts: PyFacts): PyAnalysis {
  const nodes: GraphNode[] = [];
  const nodeIndex = new Set<string>();
  const nodeById = new Map<string, GraphNode>();
  const addNode = (n: GraphNode) => {
    if (!nodeIndex.has(n.id)) {
      nodeIndex.add(n.id);
      nodeById.set(n.id, n);
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

  const files = new Set<string>();
  const rememberFile = (file: string) => files.add(normalizeFilePath(file));
  for (const item of [
    ...(facts.models ?? []),
    ...(facts.managers ?? []),
    ...(facts.signals ?? []),
    ...(facts.queryset_uses ?? []),
    ...(facts.serializers ?? []),
    ...(facts.views ?? []),
    ...(facts.registrations ?? []),
    ...(facts.includes ?? []),
    ...(facts.celery_tasks ?? []),
    ...(facts.nested_routers ?? []),
    ...(facts.http_routers ?? []),
    ...(facts.http_routes ?? []),
    ...(facts.http_mounts ?? []),
    ...(facts.imports ?? []),
    ...(facts.functions ?? []),
    ...(facts.function_calls ?? []),
  ]) {
    if ("file" in item) rememberFile(item.file);
  }
  for (const file of files) {
    addNode({ id: nodeId("File", file), kind: "File", name: file, loc: { file } });
  }

  const resolveImportFile = (fromFile: string, module: string, name: string | null): string | null => {
    const candidates = name ? [`${module}.${name}`, module] : [module];
    for (const candidate of candidates) {
      const absolute = resolvePythonModule(candidate, files, facts.base_dir);
      if (absolute) return absolute;
      const relative = resolveRelativePythonModule(fromFile, candidate, files);
      if (relative) return relative;
    }
    return null;
  };

  for (const imp of facts.imports ?? []) {
    const target = resolveImportFile(imp.file, imp.module, imp.name);
    if (!target) continue;
    addEdge("IMPORTS", nodeId("File", imp.file), nodeId("File", target));
  }

  const functionByFileName = new Map<string, string>();
  const functionByModuleName = new Map<string, string>();
  for (const fn of facts.functions ?? []) {
    const id = nodeId("Function", fn.file, fn.name);
    addNode({
      id,
      kind: "Function",
      name: fn.name,
      loc: { file: fn.file, line: fn.line },
      meta: { owner: fn.owner, ownerKind: fn.owner_kind },
    });
    functionByFileName.set(`${normalizeFilePath(fn.file)}::${fn.name}`, id);
    functionByModuleName.set(`${moduleFromFile(fn.file)}::${fn.name}`, id);
  }

  const resolveFunctionCall = (call: PyFunctionCall): string | null => {
    if (call.target_module) {
      const targetFile =
        resolvePythonModule(call.target_module, files, facts.base_dir) ??
        resolveRelativePythonModule(call.file, call.target_module, files);
      if (targetFile) {
        return functionByFileName.get(`${targetFile}::${call.target}`) ?? null;
      }
      return functionByModuleName.get(`${call.target_module}::${call.target}`) ?? null;
    }
    return functionByFileName.get(`${normalizeFilePath(call.file)}::${call.target}`) ?? null;
  };

  for (const call of facts.function_calls ?? []) {
    const from = functionByFileName.get(`${normalizeFilePath(call.file)}::${call.caller}`);
    const to = resolveFunctionCall(call);
    if (from && to && from !== to) addEdge("CALLS", from, to, "high");
  }

  // Models + fields.
  const modelByName = new Map<string, { id: string; model: PyModel }>();
  for (const m of facts.models) {
    const id = nodeId("Model", m.file, m.name);
    addNode({ id, kind: "Model", name: m.name, loc: { file: m.file, line: m.line } });
    modelByName.set(m.name, { id, model: m });
    for (const f of m.fields) {
      const fid = nodeId("Field", m.file, m.name, f.name);
      addNode({
        id: fid,
        kind: "Field",
        name: f.name,
        loc: { file: m.file, line: f.line },
        meta: { type: f.type, options: f.options },
      });
      addEdge("REFERENCES", id, fid);
    }
  }

  // Custom managers / querysets.
  const managerByName = new Map<string, string>();
  for (const manager of facts.managers ?? []) {
    const id = nodeId("Manager", manager.file, manager.name);
    addNode({ id, kind: "Manager", name: manager.name, loc: { file: manager.file, line: manager.line } });
    managerByName.set(manager.name, id);
  }
  for (const m of facts.models) {
    const model = modelByName.get(m.name);
    if (!model) continue;
    for (const manager of m.managers ?? []) {
      const managerId = managerByName.get(manager.manager);
      if (managerId) addEdge("USES", model.id, managerId);
    }
  }

  // Serializers.
  const serializerByName = new Map<string, string>();
  const serializerResponseFields = new Map<string, Array<{ id: string; name: string }>>();
  for (const s of facts.serializers) {
    const id = nodeId("Serializer", s.file, s.name);
    addNode({ id, kind: "Serializer", name: s.name, loc: { file: s.file, line: s.line } });
    serializerByName.set(s.name, id);
    if (s.model) {
      const m = modelByName.get(s.model);
      if (m) {
        addEdge("USES", id, m.id);
        const declared = new Map((s.declared_fields ?? []).map((field) => [field.name, field]));
        const fieldNames =
          s.fields === "__all__"
            ? m.model.fields.map((f) => f.name)
            : (s.fields ?? (s.declared_fields ?? []).map((field) => field.name));
        const responseFields: Array<{ id: string; name: string }> = [];
        for (const responseName of fieldNames) {
          const declaredField = declared.get(responseName);
          if (declaredField?.kind === "method") continue;
          const source = declaredField?.source ?? responseName;
          if (!source || source.includes(".")) continue;
          if (m.model.fields.some((f) => f.name === source)) {
            const fieldId = nodeId("Field", m.model.file, m.model.name, source);
            addEdge("USES", id, fieldId);
            responseFields.push({ id: fieldId, name: responseName });
          }
        }
        serializerResponseFields.set(id, responseFields);
      }
    }
  }

  // Nested serializers (DRF): parent USES nested child (second pass so forward
  // references resolve regardless of declaration order).
  for (const s of facts.serializers) {
    const parentId = serializerByName.get(s.name);
    if (!parentId) continue;
    for (const nested of s.nested ?? []) {
      const childId = serializerByName.get(nested.serializer);
      if (childId) addEdge("USES", parentId, childId);
    }
  }

  // Views / ViewSets.
  const viewByName = new Map<string, { id: string; isModelViewSet: boolean }>();
  for (const v of facts.views) {
    const kind: NodeKind = v.name.endsWith("ViewSet") ? "ViewSet" : "View";
    const id = nodeId(kind, v.file, v.name);
    addNode({ id, kind, name: v.name, loc: { file: v.file, line: v.line } });
    viewByName.set(v.name, { id, isModelViewSet: v.is_model_viewset });
    if (v.serializer_class) {
      const sid = serializerByName.get(v.serializer_class);
      if (sid) addEdge("USES", id, sid);
    }
    if (v.queryset_model) {
      const model = modelByName.get(v.queryset_model);
      if (model) addEdge("USES", id, model.id);
    }
  }
  for (const v of facts.views) {
    const view = viewByName.get(v.name);
    if (!view) continue;
    for (const fn of facts.functions ?? []) {
      if (fn.file === v.file && fn.name.startsWith(`${v.name}.`)) {
        addEdge("USES", view.id, nodeId("Function", fn.file, fn.name));
      }
    }
  }

  for (const use of facts.queryset_uses ?? []) {
    const model = modelByName.get(use.model);
    if (!model) continue;
    const owner =
      viewByName.get(use.owner)?.id ??
      managerByName.get(use.owner) ??
      nodeId("Function", use.file, use.owner);
    if (!nodeIndex.has(owner)) {
      const kind: NodeKind = use.owner_kind === "manager" ? "Manager" : "Function";
      addNode({ id: owner, kind, name: use.owner, loc: { file: use.file, line: use.line } });
    }
    addEdge("USES", owner, model.id);
  }

  for (const signal of facts.signals ?? []) {
    const signalId = nodeId("Signal", signal.file, signal.signal, signal.sender ?? "any", signal.name);
    const handlerId = nodeId("Function", signal.file, signal.name);
    addNode({
      id: signalId,
      kind: "Signal",
      name: `${signal.signal}:${signal.name}`,
      loc: { file: signal.file, line: signal.line },
      meta: { signal: signal.signal, sender: signal.sender },
    });
    addNode({
      id: handlerId,
      kind: "Function",
      name: signal.name,
      loc: { file: signal.file, line: signal.line },
    });
    addEdge("REGISTERED_IN", handlerId, signalId);
    if (signal.sender) {
      const model = modelByName.get(signal.sender);
      if (model) addEdge("USES", handlerId, model.id);
    }
  }

  // Celery tasks.
  for (const t of facts.celery_tasks) {
    addNode({
      id: nodeId("CeleryTask", t.file, t.name),
      kind: "CeleryTask",
      name: t.name,
      loc: { file: t.file, line: t.line },
    });
  }

  // Routes: include() + router prefixes -> canonical endpoints.
  const mounts = computeMounts(facts);
  const routerPrefixes = routerPrefixMap(facts);
  const routes: BackendRoute[] = [];
  const responseFieldsForModel = (model: string | null | undefined): Array<{ id: string; name: string }> => {
    if (!model) return [];
    const found = modelByName.get(model);
    if (!found) return [];
    return found.model.fields.map((field) => ({
      id: nodeId("Field", found.model.file, found.model.name, field.name),
      name: field.name,
    }));
  };
  const responseFieldsForView = (viewId: string | null): Array<{ id: string; name: string }> => {
    if (!viewId) return [];
    const serializers = new Set(
      edges
        .filter((edge) => edge.kind === "USES" && edge.from === viewId)
        .filter((edge) => nodeById.get(edge.to)?.kind === "Serializer")
        .map((edge) => edge.to),
    );
    return [...serializers].flatMap((serializer) => serializerResponseFields.get(serializer) ?? []);
  };
  const addEndpoint = (method: string, p: string, viewId: string | null) => {
    const path = normPath(p);
    const endpointId = nodeId("APIEndpoint", `${method} ${path}`);
    addNode({
      id: endpointId,
      kind: "APIEndpoint",
      name: `${method} ${path}`,
      meta: { method, path },
    });
    if (viewId) addEdge("EXPOSES", viewId, endpointId);
    routes.push({
      method,
      path,
      viewsetId: viewId,
      endpointId,
      responseFields: responseFieldsForView(viewId),
    });
  };

  for (const reg of facts.registrations) {
    const view = viewByName.get(reg.viewset);
    const viewId = view?.id ?? null;
    const isModel = view?.isModelViewSet ?? true;
    const prefixes = mounts.get(reg.file) ?? [""];
    for (const mount of prefixes) {
      for (const routerPrefix of routerPrefixes.get(reg.router ?? "") ?? [""]) {
        const collection = `${mount}${routerPrefix}${reg.prefix}/`;
        const detail = `${mount}${routerPrefix}${reg.prefix}/{id}/`;
        const collectionMethods = isModel ? ["GET", "POST"] : ["GET"];
        const detailMethods = isModel ? ["GET", "PUT", "PATCH", "DELETE"] : ["GET"];
        for (const m of collectionMethods) addEndpoint(m, collection, viewId);
        for (const m of detailMethods) addEndpoint(m, detail, viewId);
      }
    }
  }

  appendHttpRoutes(facts, { addNode, addEdge, routes, responseFieldsForModel });

  return { nodes, edges, routes };
}
