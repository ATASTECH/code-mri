import { readFileSync } from "node:fs";
import * as path from "node:path";
import { load } from "js-yaml";
import type { GraphEdge, GraphNode } from "@code-mri/shared-types";
import { edgeId, nodeId } from "../../ids.js";

export interface DockerAnalysis {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface ComposeService {
  build?: unknown;
  command?: unknown;
  depends_on?: unknown;
  environment?: unknown;
  image?: unknown;
  ports?: unknown;
}

interface ComposeFile {
  services?: Record<string, ComposeService>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serviceNames(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  if (isRecord(value)) {
    return Object.keys(value);
  }

  return [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function serviceMeta(service: ComposeService): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    ports: stringArray(service.ports),
  };
  if (service.build !== undefined) meta.build = service.build;
  if (service.command !== undefined) meta.command = service.command;
  if (service.environment !== undefined) meta.environment = service.environment;
  if (service.image !== undefined) meta.image = service.image;
  return meta;
}

function composeServiceId(file: string, service: string): string {
  return nodeId("DockerService", file, service);
}

export function analyzeDockerCompose(
  root: string,
  files: { path: string; abs?: string }[],
): DockerAnalysis {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  for (const file of files) {
    const abs = file.abs ?? path.join(root, file.path);
    let parsed: unknown;
    try {
      parsed = load(readFileSync(abs, "utf8"));
    } catch {
      continue;
    }

    if (!isRecord(parsed) || !isRecord(parsed.services)) continue;
    const compose = parsed as ComposeFile;
    const services = compose.services ?? {};

    for (const [name, rawService] of Object.entries(services)) {
      if (!isRecord(rawService)) continue;
      const service = rawService as ComposeService;
      const id = composeServiceId(file.path, name);
      nodes.push({
        id,
        kind: "DockerService",
        name,
        loc: { file: file.path },
        meta: serviceMeta(service),
      });
    }

    for (const [name, rawService] of Object.entries(services)) {
      if (!isRecord(rawService)) continue;
      const from = composeServiceId(file.path, name);
      for (const dependency of serviceNames(rawService.depends_on)) {
        if (!services[dependency]) continue;
        const to = composeServiceId(file.path, dependency);
        edges.push({
          id: edgeId("DEPENDS_ON", from, to),
          from,
          to,
          kind: "DEPENDS_ON",
        });
      }
    }
  }

  return { nodes, edges };
}
