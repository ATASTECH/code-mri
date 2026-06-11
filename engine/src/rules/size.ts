import type { Issue } from "../types.js";
import type { Graph } from "../graph/graph.js";

/** Models with an excessive number of fields (REFERENCES out-edges). */
export function findGodModels(graph: Graph, threshold: number): Issue[] {
  const issues: Issue[] = [];
  for (const node of graph.nodes()) {
    if (node.kind !== "Model") continue;
    const fields = graph.outEdges(node.id).filter((e) => e.kind === "REFERENCES").length;
    if (fields > threshold) {
      issues.push({
        kind: "GOD_MODEL",
        severity: "medium",
        message: `Model "${node.name}" has ${fields} fields (> ${threshold})`,
        nodes: [node.id],
        meta: { fields },
      });
    }
  }
  return issues;
}

/** Files whose line count exceeds the threshold. */
export function findLargeFiles(
  graph: Graph,
  loc: Map<string, number>,
  threshold: number,
): Issue[] {
  const issues: Issue[] = [];
  for (const node of graph.nodes()) {
    if (node.kind !== "File") continue;
    const lines = loc.get(node.id);
    if (lines !== undefined && lines > threshold) {
      issues.push({
        kind: "LARGE_FILE",
        severity: "low",
        message: `File "${node.name}" is ${lines} lines (> ${threshold})`,
        nodes: [node.id],
        meta: { loc: lines },
      });
    }
  }
  return issues;
}
