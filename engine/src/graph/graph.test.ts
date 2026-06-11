import type { GraphEdge, GraphNode } from "../types.js";
import { describe, expect, test } from "vitest";
import { Graph } from "./graph.js";

function n(id: string): GraphNode {
  return { id, kind: "File", name: id };
}
function e(kind: GraphEdge["kind"], from: string, to: string): GraphEdge {
  return { id: `${kind}:${from}->${to}`, from, to, kind };
}

describe("Graph store", () => {
  test("dedupes nodes and edges by id", () => {
    const g = new Graph();
    g.addNode(n("a"));
    g.addNode(n("a"));
    g.addEdge(e("USES", "a", "b"));
    g.addEdge(e("USES", "a", "b"));
    expect(g.nodes()).toHaveLength(1);
    expect(g.edges()).toHaveLength(1);
  });

  test("exposes out- and in-edges (reverse index)", () => {
    const g = new Graph();
    g.addEdge(e("USES", "a", "b"));
    expect(g.outEdges("a").map((x) => x.to)).toEqual(["b"]);
    expect(g.inEdges("b").map((x) => x.from)).toEqual(["a"]);
  });
});

describe("impact analysis", () => {
  // Models the golden chain: changing the email field should reach the page.
  function chain(): Graph {
    const g = new Graph();
    for (const id of ["email", "serializer", "viewset", "endpoint", "hook", "page"]) {
      g.addNode({ id, kind: "File", name: id });
    }
    g.addEdge(e("USES", "serializer", "email"));
    g.addEdge(e("USES", "viewset", "serializer"));
    g.addEdge(e("EXPOSES", "viewset", "endpoint"));
    g.addEdge(e("CALLS", "hook", "endpoint"));
    g.addEdge(e("USES", "page", "hook"));
    return g;
  }

  test("walks dependents across mixed edge directions", () => {
    const ids = chain()
      .impact("email")
      .map((node) => node.id)
      .sort();
    expect(ids).toEqual(["endpoint", "hook", "page", "serializer", "viewset"]);
  });

  test("does not include the start node itself", () => {
    expect(chain().impact("email").some((node) => node.id === "email")).toBe(false);
  });
});
