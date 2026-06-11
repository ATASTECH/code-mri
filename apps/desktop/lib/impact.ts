import type { EdgeKind, GraphEdge, GraphNode } from "@code-mri/engine"

/** Mirror of the engine's impact direction rules (see engine graph.ts). */
const IMPACT_REVERSE = new Set<EdgeKind>([
  "USES",
  "CALLS",
  "RENDERS",
  "DEPENDS_ON",
  "TYPES",
  "CONSUMES",
  "PROVIDES",
])
const IMPACT_FORWARD = new Set<EdgeKind>(["EXPOSES", "PROVIDES"])

export interface ReportGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface Subgraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

function pushTo(map: Map<string, GraphEdge[]>, key: string, edge: GraphEdge): void {
  const list = map.get(key)
  if (list) list.push(edge)
  else map.set(key, [edge])
}

/**
 * Compute the focus+context subgraph affected if `startId` changes: the start
 * node plus its transitive dependents, and every edge between included nodes.
 */
export function impactSubgraph(report: ReportGraph, startId: string): Subgraph {
  const inByTo = new Map<string, GraphEdge[]>()
  const outByFrom = new Map<string, GraphEdge[]>()
  for (const e of report.edges) {
    pushTo(inByTo, e.to, e)
    pushTo(outByFrom, e.from, e)
  }

  const included = new Set<string>([startId])
  const queue = [startId]
  while (queue.length > 0) {
    const id = queue.shift() as string
    const neighbors: string[] = []
    for (const e of inByTo.get(id) ?? []) if (IMPACT_REVERSE.has(e.kind)) neighbors.push(e.from)
    for (const e of outByFrom.get(id) ?? []) if (IMPACT_FORWARD.has(e.kind)) neighbors.push(e.to)
    for (const next of neighbors) {
      if (!included.has(next)) {
        included.add(next)
        queue.push(next)
      }
    }
  }

  const byId = new Map(report.nodes.map((n) => [n.id, n]))
  const nodes = [...included]
    .map((id) => byId.get(id))
    .filter((n): n is GraphNode => n !== undefined)
  const edges = report.edges.filter((e) => included.has(e.from) && included.has(e.to))
  return { nodes, edges }
}
