import type { GraphEdge, GraphNode } from "@code-mri/shared-types"
import { describe, expect, test } from "vitest"
import { impactSubgraph } from "./impact"

const node = (id: string): GraphNode => ({ id, kind: "File", name: id })
const edge = (kind: GraphEdge["kind"], from: string, to: string): GraphEdge => ({
  id: `${kind}:${from}->${to}`,
  from,
  to,
  kind,
})

const report = {
  nodes: ["email", "serializer", "viewset", "endpoint", "hook", "page"].map(node),
  edges: [
    edge("USES", "serializer", "email"),
    edge("USES", "viewset", "serializer"),
    edge("EXPOSES", "viewset", "endpoint"),
    edge("CALLS", "hook", "endpoint"),
    edge("USES", "page", "hook"),
  ],
}

describe("impactSubgraph", () => {
  test("includes the start node plus all impacted dependents", () => {
    const { nodes } = impactSubgraph(report, "email")
    expect(new Set(nodes.map((n) => n.id))).toEqual(
      new Set(["email", "serializer", "viewset", "endpoint", "hook", "page"]),
    )
  })

  test("only keeps edges between included nodes", () => {
    const { nodes, edges } = impactSubgraph(report, "email")
    const ids = new Set(nodes.map((n) => n.id))
    expect(edges.every((e) => ids.has(e.from) && ids.has(e.to))).toBe(true)
    expect(edges.length).toBeGreaterThan(0)
  })

  test("an isolated node yields just itself", () => {
    const { nodes, edges } = impactSubgraph(report, "page")
    expect(nodes.map((n) => n.id)).toEqual(["page"])
    expect(edges).toEqual([])
  })
})
