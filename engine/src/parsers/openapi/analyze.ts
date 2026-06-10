import { readFileSync } from "node:fs";
import * as path from "node:path";
import { load } from "js-yaml";
import type { GraphNode } from "@code-mri/shared-types";
import { nodeId } from "../../ids.js";
import type { BackendRoute } from "../py/assemble.js";

export interface OpenApiAnalysis {
  nodes: GraphNode[];
  routes: BackendRoute[];
}

const HTTP_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
  "trace",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanPath(value: string): string {
  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
  return withLeadingSlash.replace(/\/+/g, "/");
}

function endpointId(method: string, routePath: string): string {
  return nodeId("APIEndpoint", `${method.toUpperCase()} ${routePath}`);
}

function operationMeta(
  method: string,
  routePath: string,
  operation: unknown,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    method: method.toUpperCase(),
    path: routePath,
    source: "openapi",
  };

  if (isRecord(operation)) {
    if (typeof operation.operationId === "string") {
      base.operationId = operation.operationId;
    }
    if (typeof operation.summary === "string") {
      base.summary = operation.summary;
    }
  }

  return base;
}

export function analyzeOpenApiSpec(root: string, specPath: string): OpenApiAnalysis {
  const abs = path.isAbsolute(specPath) ? specPath : path.resolve(root, specPath);
  const rel = path.relative(root, abs).split(path.sep).join("/");
  const parsed = load(readFileSync(abs, "utf8"));
  if (!isRecord(parsed) || !isRecord(parsed.paths)) {
    return { nodes: [], routes: [] };
  }

  const nodes: GraphNode[] = [];
  const routes: BackendRoute[] = [];
  for (const [rawPath, rawPathItem] of Object.entries(parsed.paths)) {
    if (typeof rawPath !== "string" || !isRecord(rawPathItem)) continue;
    const routePath = cleanPath(rawPath);

    for (const [rawMethod, operation] of Object.entries(rawPathItem)) {
      const method = rawMethod.toLowerCase();
      if (!HTTP_METHODS.has(method)) continue;

      const id = endpointId(method, routePath);
      nodes.push({
        id,
        kind: "APIEndpoint",
        name: `${method.toUpperCase()} ${routePath}`,
        loc: { file: rel },
        meta: operationMeta(method, routePath, operation),
      });
      routes.push({
        method: method.toUpperCase(),
        path: routePath,
        viewsetId: null,
        endpointId: id,
      });
    }
  }

  return { nodes, routes };
}
