import type { GraphEdge, GraphNode } from "../types.js";
import { describe, expect, test } from "vitest";
import { buildGraph } from "../graph/build.js";
import { findCircularDependencies } from "./circular.js";

const file = (id: string): GraphNode => ({ id, kind: "File", name: id });
const imp = (from: string, to: string): GraphEdge => ({
  id: `IMPORTS:${from}->${to}`,
  from,
  to,
  kind: "IMPORTS",
});

describe("findCircularDependencies", () => {
  test("reports a cycle and ignores acyclic imports", () => {
    const g = buildGraph({
      nodes: ["a", "b", "c", "d", "e"].map(file),
      edges: [imp("a", "b"), imp("b", "c"), imp("c", "a"), imp("d", "e")],
    });
    const issues = findCircularDependencies(g);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.kind).toBe("CIRCULAR_DEPENDENCY");
    expect([...(issues[0]?.nodes ?? [])].sort()).toEqual(["a", "b", "c"]);
  });

  test("returns nothing when there are no cycles", () => {
    const g = buildGraph({ nodes: [file("a"), file("b")], edges: [imp("a", "b")] });
    expect(findCircularDependencies(g)).toEqual([]);
  });
});
