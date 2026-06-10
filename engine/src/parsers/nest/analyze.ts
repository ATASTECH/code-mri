import { readFileSync } from "node:fs";
import * as path from "node:path";
import {
  type ClassDeclaration,
  type Decorator,
  Node,
  Project,
  type SourceFile,
  ts,
} from "ts-morph";
import type { GraphEdge, GraphNode } from "@code-mri/shared-types";
import { edgeId, nodeId } from "../../ids.js";
import type { BackendRoute } from "../py/assemble.js";

const HTTP_DECORATORS = new Set(["Get", "Post", "Put", "Patch", "Delete"]);

export interface NestAnalysis {
  nodes: GraphNode[];
  edges: GraphEdge[];
  routes: BackendRoute[];
}

type ClassType = "controller" | "provider" | "module";

interface NestClass {
  id: string;
  rel: string;
  name: string;
  type: ClassType;
  /** Controller prefix from `@Controller("prefix")`. */
  prefix: string;
}

interface NestRoute {
  controller: NestClass;
  method: string;
  path: string;
  line: number;
}

interface ModuleLink {
  module: NestClass;
  /** Referenced class names in controllers/providers arrays. */
  members: string[];
}

interface DiLink {
  controller: NestClass;
  /** Constructor-injected type names. */
  deps: string[];
}

function createTsProject(): Project {
  return new Project({
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      allowJs: true,
      experimentalDecorators: true,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
  });
}

function cleanPath(value: string): string {
  const raw = value.trim() || "/";
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
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

/** First string-literal argument of a decorator, or "". */
function decoratorStringArg(dec: Decorator | undefined): string {
  if (!dec) return "";
  const arg = dec.getArguments()[0];
  if (!arg) return "";
  if (Node.isStringLiteral(arg)) return arg.getLiteralValue();
  if (Node.isNoSubstitutionTemplateLiteral(arg)) return arg.getLiteralText();
  return "";
}

function classType(cls: ClassDeclaration): ClassType | null {
  if (cls.getDecorator("Controller")) return "controller";
  if (cls.getDecorator("Module")) return "module";
  if (cls.getDecorator("Injectable")) return "provider";
  return null;
}

/** Identifier names inside an array-valued property of the @Module object. */
function moduleArrayMembers(cls: ClassDeclaration, propName: string): string[] {
  const dec = cls.getDecorator("Module");
  const arg = dec?.getArguments()[0];
  if (!arg || !Node.isObjectLiteralExpression(arg)) return [];
  const prop = arg.getProperty(propName);
  if (!prop || !Node.isPropertyAssignment(prop)) return [];
  const init = prop.getInitializer();
  if (!init || !Node.isArrayLiteralExpression(init)) return [];
  return init
    .getElements()
    .map((el) => (Node.isIdentifier(el) ? el.getText() : null))
    .filter((n): n is string => !!n);
}

/** Constructor-injected parameter type names. */
function constructorDeps(cls: ClassDeclaration): string[] {
  const ctor = cls.getConstructors()[0];
  if (!ctor) return [];
  const deps: string[] = [];
  for (const param of ctor.getParameters()) {
    const typeNode = param.getTypeNode();
    if (typeNode && Node.isTypeReference(typeNode)) {
      deps.push(typeNode.getTypeName().getText());
    }
  }
  return deps;
}

/** Analyze NestJS controllers/providers/modules and emit backend routes. */
export function analyzeNest(
  _root: string,
  files: { path: string; abs: string }[],
): NestAnalysis {
  const project = createTsProject();
  const sources: { sf: SourceFile; rel: string }[] = files.map((file) => {
    const text = readFileSync(path.resolve(file.abs), "utf8");
    const sf = project.createSourceFile(path.resolve(file.abs), text, { overwrite: true });
    return { sf, rel: file.path };
  });

  const classes: NestClass[] = [];
  const byName = new Map<string, NestClass>();
  const routes: NestRoute[] = [];
  const moduleLinks: ModuleLink[] = [];
  const diLinks: DiLink[] = [];

  for (const { sf, rel } of sources) {
    for (const cls of sf.getClasses()) {
      const type = classType(cls);
      const name = cls.getName();
      if (!type || !name) continue;
      const nest: NestClass = {
        id: nodeId("Service", rel, name),
        rel,
        name,
        type,
        prefix: type === "controller" ? cleanPath(decoratorStringArg(cls.getDecorator("Controller"))) : "/",
      };
      classes.push(nest);
      byName.set(name, nest);

      if (type === "controller") {
        for (const method of cls.getMethods()) {
          for (const dec of method.getDecorators()) {
            const decName = dec.getName();
            if (!HTTP_DECORATORS.has(decName)) continue;
            routes.push({
              controller: nest,
              method: decName.toUpperCase(),
              path: joinPaths(nest.prefix, decoratorStringArg(dec)),
              line: method.getStartLineNumber(),
            });
          }
        }
        const deps = constructorDeps(cls);
        if (deps.length > 0) diLinks.push({ controller: nest, deps });
      }

      if (type === "module") {
        const members = [
          ...moduleArrayMembers(cls, "controllers"),
          ...moduleArrayMembers(cls, "providers"),
        ];
        if (members.length > 0) moduleLinks.push({ module: nest, members });
      }
    }
  }

  const nodes: GraphNode[] = [];
  const nodeIndex = new Set<string>();
  const edges: GraphEdge[] = [];
  const edgeIndex = new Set<string>();
  const backendRoutes: BackendRoute[] = [];

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

  for (const cls of classes) {
    addNode({
      id: cls.id,
      kind: "Service",
      name: cls.name,
      loc: { file: cls.rel },
      meta: { framework: "nest", type: cls.type },
    });
  }

  for (const link of moduleLinks) {
    for (const memberName of link.members) {
      const member = byName.get(memberName);
      if (member) addEdge("REGISTERED_IN", member.id, link.module.id);
    }
  }

  for (const link of diLinks) {
    for (const depName of link.deps) {
      const dep = byName.get(depName);
      if (dep) addEdge("DEPENDS_ON", link.controller.id, dep.id);
    }
  }

  for (const route of routes) {
    const routeId = nodeId("Route", route.controller.rel, `${route.method} ${route.path}`);
    const endpointId = nodeId("APIEndpoint", `${route.method} ${route.path}`);

    addNode({
      id: routeId,
      kind: "Route",
      name: `${route.method} ${route.path}`,
      loc: { file: route.controller.rel, line: route.line },
      meta: {
        framework: "nest",
        method: route.method,
        path: route.path,
        controller: route.controller.name,
      },
    });
    addNode({
      id: endpointId,
      kind: "APIEndpoint",
      name: `${route.method} ${route.path}`,
      meta: { method: route.method, path: route.path, source: "nest" },
    });
    addEdge("REGISTERED_IN", routeId, route.controller.id);
    addEdge("EXPOSES", routeId, endpointId);
    backendRoutes.push({
      method: route.method,
      path: route.path,
      viewsetId: routeId,
      endpointId,
    });
  }

  return { nodes, edges, routes: backendRoutes };
}
