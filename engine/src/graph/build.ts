import type { GraphEdge, GraphNode } from "@code-mri/shared-types";
import { Graph } from "./graph.js";

export interface GraphParts {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Merge analysis fragments (scanner, TS, Python, linker) into one Graph. */
export function buildGraph(...parts: GraphParts[]): Graph {
  const g = new Graph();
  for (const part of parts) {
    for (const node of part.nodes) g.addNode(node);
    for (const edge of part.edges) g.addEdge(edge);
  }
  return g;
}
