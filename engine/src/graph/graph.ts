import type { EdgeKind, GraphEdge, GraphNode } from "../types.js";

/**
 * Edge kinds whose *source* depends on the *target* — so a change to the target
 * impacts the source. Impact traversal follows these edges in reverse.
 */
const IMPACT_REVERSE = new Set<EdgeKind>([
  "USES",
  "CALLS",
  "RENDERS",
  "DEPENDS_ON",
  "TYPES",
  "CONSUMES",
  "PROVIDES",
]);
/**
 * Edge kinds where the *target* depends on the *source* (e.g. a ViewSet EXPOSES
 * an endpoint). Impact traversal follows these forward.
 */
const IMPACT_FORWARD = new Set<EdgeKind>(["EXPOSES", "PROVIDES"]);

/**
 * In-memory graph store with a reverse-dependency index and impact queries.
 * Nodes and edges dedupe by id.
 */
export class Graph {
  private readonly nodeMap = new Map<string, GraphNode>();
  private readonly edgeList: GraphEdge[] = [];
  private readonly out = new Map<string, GraphEdge[]>();
  private readonly in = new Map<string, GraphEdge[]>();
  private readonly edgeIds = new Set<string>();

  addNode(node: GraphNode): void {
    if (!this.nodeMap.has(node.id)) this.nodeMap.set(node.id, node);
  }

  addEdge(edge: GraphEdge): void {
    if (this.edgeIds.has(edge.id)) return;
    this.edgeIds.add(edge.id);
    this.edgeList.push(edge);
    this.index(this.out, edge.from, edge);
    this.index(this.in, edge.to, edge);
  }

  private index(map: Map<string, GraphEdge[]>, key: string, edge: GraphEdge): void {
    const list = map.get(key);
    if (list) list.push(edge);
    else map.set(key, [edge]);
  }

  getNode(id: string): GraphNode | undefined {
    return this.nodeMap.get(id);
  }

  nodes(): GraphNode[] {
    return [...this.nodeMap.values()];
  }

  edges(): GraphEdge[] {
    return [...this.edgeList];
  }

  outEdges(id: string): GraphEdge[] {
    return this.out.get(id) ?? [];
  }

  inEdges(id: string): GraphEdge[] {
    return this.in.get(id) ?? [];
  }

  /**
   * Nodes affected if `startId` changes — transitive dependents, following
   * USES/CALLS/RENDERS/DEPENDS_ON in reverse and EXPOSES forward.
   */
  impact(startId: string): GraphNode[] {
    const visited = new Set<string>([startId]);
    const queue = [startId];
    const result: GraphNode[] = [];

    while (queue.length > 0) {
      const id = queue.shift() as string;
      const neighbors: string[] = [];
      for (const edge of this.inEdges(id)) {
        if (IMPACT_REVERSE.has(edge.kind)) neighbors.push(edge.from);
      }
      for (const edge of this.outEdges(id)) {
        if (IMPACT_FORWARD.has(edge.kind)) neighbors.push(edge.to);
      }
      for (const next of neighbors) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
        const node = this.nodeMap.get(next);
        if (node) result.push(node);
      }
    }
    return result;
  }
}
