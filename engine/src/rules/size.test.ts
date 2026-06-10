import type { GraphEdge, GraphNode } from "@code-mri/shared-types";
import { describe, expect, test } from "vitest";
import { buildGraph } from "../graph/build.js";
import { findGodModels, findLargeFiles } from "./size.js";

describe("findGodModels", () => {
  test("flags models with more fields than the threshold", () => {
    const nodes: GraphNode[] = [{ id: "M", kind: "Model", name: "Big" }];
    const edges: GraphEdge[] = [];
    for (let i = 0; i < 4; i++) {
      nodes.push({ id: `f${i}`, kind: "Field", name: `f${i}` });
      edges.push({ id: `REFERENCES:M->f${i}`, from: "M", to: `f${i}`, kind: "REFERENCES" });
    }
    const g = buildGraph({ nodes, edges });
    expect(findGodModels(g, 3).map((i) => i.nodes[0])).toEqual(["M"]);
    expect(findGodModels(g, 10)).toEqual([]);
  });
});

describe("findLargeFiles", () => {
  test("flags files whose line count exceeds the threshold", () => {
    const g = buildGraph({
      nodes: [
        { id: "big.ts", kind: "File", name: "big.ts" },
        { id: "small.ts", kind: "File", name: "small.ts" },
      ],
      edges: [],
    });
    const loc = new Map([
      ["big.ts", 500],
      ["small.ts", 20],
    ]);
    expect(findLargeFiles(g, loc, 300).map((i) => i.nodes[0])).toEqual(["big.ts"]);
  });
});
