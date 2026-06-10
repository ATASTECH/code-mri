import type { GraphEdge, GraphNode } from "@code-mri/shared-types";
import { describe, expect, test } from "vitest";
import { buildGraph } from "./build.js";

const node = (id: string): GraphNode => ({ id, kind: "File", name: id });
const edge = (from: string, to: string): GraphEdge => ({
  id: `USES:${from}->${to}`,
  from,
  to,
  kind: "USES",
});

describe("buildGraph", () => {
  test("merges fragments and dedupes shared nodes", () => {
    const g = buildGraph(
      { nodes: [node("a"), node("b")], edges: [edge("a", "b")] },
      { nodes: [node("b"), node("c")], edges: [edge("b", "c")] },
    );
    expect(g.nodes().map((n) => n.id).sort()).toEqual(["a", "b", "c"]);
    expect(g.edges()).toHaveLength(2);
  });
});
