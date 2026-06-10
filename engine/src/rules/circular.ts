import type { Issue } from "@code-mri/shared-types";
import type { Graph } from "../graph/graph.js";

/**
 * Detect import cycles using Tarjan's strongly-connected-components algorithm
 * over IMPORTS edges. Each SCC with more than one member (or a self-import) is
 * reported as a CIRCULAR_DEPENDENCY issue.
 */
export function findCircularDependencies(graph: Graph): Issue[] {
  // Adjacency restricted to IMPORTS edges.
  const adj = new Map<string, string[]>();
  const selfLoops = new Set<string>();
  for (const edge of graph.edges()) {
    if (edge.kind !== "IMPORTS") continue;
    if (edge.from === edge.to) selfLoops.add(edge.from);
    (adj.get(edge.from) ?? adj.set(edge.from, []).get(edge.from)!).push(edge.to);
  }

  let index = 0;
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  const strongConnect = (v: string): void => {
    indices.set(v, index);
    low.set(v, index);
    index += 1;
    stack.push(v);
    onStack.add(v);

    for (const w of adj.get(v) ?? []) {
      if (!indices.has(w)) {
        strongConnect(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, indices.get(w)!));
      }
    }

    if (low.get(v) === indices.get(v)) {
      const component: string[] = [];
      let w: string;
      do {
        w = stack.pop() as string;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      sccs.push(component);
    }
  };

  for (const v of adj.keys()) {
    if (!indices.has(v)) strongConnect(v);
  }

  const issues: Issue[] = [];
  for (const scc of sccs) {
    const isCycle = scc.length > 1 || (scc[0] !== undefined && selfLoops.has(scc[0]));
    if (!isCycle) continue;
    issues.push({
      kind: "CIRCULAR_DEPENDENCY",
      severity: "high",
      message: `Import cycle between ${scc.length} files: ${scc.join(" → ")}`,
      nodes: scc,
    });
  }
  return issues;
}
