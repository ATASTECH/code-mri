import type { GraphEdge, GraphNode } from "../types.js";
import { describe, expect, test } from "vitest";
import { buildGraph } from "../graph/build.js";
import { runRules } from "./index.js";

describe("runRules", () => {
  test("aggregates findings from all rule modules", () => {
    const nodes: GraphNode[] = [
      { id: "a", kind: "File", name: "a" },
      { id: "b", kind: "File", name: "b" },
      { id: "Dead", kind: "Component", name: "Dead" },
    ];
    const edges: GraphEdge[] = [
      { id: "IMPORTS:a->b", from: "a", to: "b", kind: "IMPORTS" },
      { id: "IMPORTS:b->a", from: "b", to: "a", kind: "IMPORTS" },
    ];
    const kinds = new Set(runRules(buildGraph({ nodes, edges })).map((i) => i.kind));
    expect(kinds.has("CIRCULAR_DEPENDENCY")).toBe(true);
    expect(kinds.has("DEAD_CODE")).toBe(true);
  });
});
