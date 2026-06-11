import type { GraphEdge, GraphNode, Issue } from "../types.js";
import type { CodeMriConfig } from "../config/codemri.js";
import { matchesAnyGlob } from "../config/glob.js";

function nodeFile(node: GraphNode | undefined): string | null {
  if (!node) return null;
  if (node.loc?.file) return node.loc.file;
  return node.kind === "File" ? node.name : null;
}

function issueFiles(
  issue: Issue,
  nodes: Map<string, GraphNode>,
  neighbors: Map<string, string[]>,
): string[] {
  const files = new Set<string>();
  for (const id of issue.nodes) {
    const file = nodeFile(nodes.get(id));
    if (file) files.add(file);
    else if (id.startsWith("File:")) files.add(id.slice("File:".length));
    else {
      // Location-less nodes (e.g. APIEndpoint) inherit the files of their
      // direct edge neighbors, so endpoints exposed only from ignored paths
      // can be filtered like any other issue.
      for (const neighborId of neighbors.get(id) ?? []) {
        const neighborFile = nodeFile(nodes.get(neighborId));
        if (neighborFile) files.add(neighborFile);
      }
    }
  }

  const metaFile = issue.meta?.file;
  if (typeof metaFile === "string") files.add(metaFile);
  const metaFiles = issue.meta?.files;
  if (Array.isArray(metaFiles)) {
    for (const file of metaFiles) {
      if (typeof file === "string") files.add(file);
    }
  }
  return [...files];
}

export function filterIgnoredRiskIssues(
  issues: Issue[],
  nodes: GraphNode[],
  config: CodeMriConfig,
  edges: GraphEdge[] = [],
): Issue[] {
  const patterns = config.risk.ignorePaths;
  if (patterns.length === 0) return issues;

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const neighbors = new Map<string, string[]>();
  for (const edge of edges) {
    const fromList = neighbors.get(edge.from) ?? [];
    fromList.push(edge.to);
    neighbors.set(edge.from, fromList);
    const toList = neighbors.get(edge.to) ?? [];
    toList.push(edge.from);
    neighbors.set(edge.to, toList);
  }
  return issues.filter((issue) => {
    const files = issueFiles(issue, byId, neighbors);
    return files.length === 0 || !files.every((file) => matchesAnyGlob(patterns, file));
  });
}
