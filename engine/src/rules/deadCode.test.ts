import type { GraphEdge, GraphNode } from "@code-mri/shared-types";
import { describe, expect, test } from "vitest";
import { buildGraph } from "../graph/build.js";
import { findDeadCode } from "./deadCode.js";

const node = (id: string, kind: GraphNode["kind"]): GraphNode => ({ id, kind, name: id });
const edge = (kind: GraphEdge["kind"], from: string, to: string): GraphEdge => ({
  id: `${kind}:${from}->${to}`,
  from,
  to,
  kind,
});

describe("findDeadCode", () => {
  test("flags components with no incoming RENDERS as candidates", () => {
    const g = buildGraph({
      nodes: [node("page", "Page"), node("Used", "Component"), node("Unused", "Component")],
      edges: [edge("RENDERS", "page", "Used")],
    });
    const dead = findDeadCode(g).filter((i) => i.kind === "DEAD_CODE");
    expect(dead.map((i) => i.nodes[0])).toEqual(["Unused"]);
    expect(dead[0]?.candidate).toBe(true);
  });

  test("flags hooks with no incoming USES", () => {
    const g = buildGraph({
      nodes: [node("page", "Page"), node("usedHook", "Hook"), node("deadHook", "Hook")],
      edges: [edge("USES", "page", "usedHook")],
    });
    const dead = findDeadCode(g).filter((i) => i.kind === "DEAD_CODE");
    expect(dead.map((i) => i.nodes[0])).toContain("deadHook");
    expect(dead.map((i) => i.nodes[0])).not.toContain("usedHook");
  });

  test("rates an unexported unused component higher confidence than an exported one", () => {
    const exported: GraphNode = {
      id: "Exp",
      kind: "Component",
      name: "Exp",
      meta: { exported: true },
    };
    const internal: GraphNode = {
      id: "Int",
      kind: "Component",
      name: "Int",
      meta: { exported: false },
    };
    const g = buildGraph({ nodes: [exported, internal], edges: [] });

    const dead = findDeadCode(g).filter((i) => i.kind === "DEAD_CODE");
    const confidenceByNode = Object.fromEntries(
      dead.map((i) => [i.nodes[0], i.meta?.confidence]),
    );

    expect(confidenceByNode["Int"]).toBe("high"); // not exported → safe to remove
    expect(confidenceByNode["Exp"]).toBe("low"); // exported → maybe public API
  });

  test("flags endpoints with no incoming CALLS as UNUSED_ENDPOINT", () => {
    const g = buildGraph({
      nodes: [node("hook", "Hook"), node("calledEp", "APIEndpoint"), node("uncalledEp", "APIEndpoint")],
      edges: [edge("CALLS", "hook", "calledEp")],
    });
    const unused = findDeadCode(g).filter((i) => i.kind === "UNUSED_ENDPOINT");
    expect(unused.map((i) => i.nodes[0])).toEqual(["uncalledEp"]);
  });

  test("does not flag components/hooks in Next.js convention files", () => {
    const layoutHelper: GraphNode = {
      id: "L",
      kind: "Component",
      name: "LayoutHelper",
      loc: { file: "app/layout.tsx" },
      meta: { exported: true },
    };
    const mwHook: GraphNode = {
      id: "M",
      kind: "Hook",
      name: "useEdgeConfig",
      loc: { file: "middleware.ts" },
      meta: { exported: true },
    };
    const orphan: GraphNode = {
      id: "O",
      kind: "Component",
      name: "Orphan",
      loc: { file: "components/Orphan.tsx" },
      meta: { exported: false },
    };
    const g = buildGraph({ nodes: [layoutHelper, mwHook, orphan], edges: [] });
    const dead = findDeadCode(g).filter((i) => i.kind === "DEAD_CODE");
    expect(dead.map((i) => i.nodes[0])).toEqual(["O"]);
  });

  test("does not flag framework-convention export names", () => {
    const gm: GraphNode = {
      id: "GM",
      kind: "Component",
      name: "generateMetadata",
      loc: { file: "app/blog/helpers.ts" },
      meta: { exported: true },
    };
    const g = buildGraph({ nodes: [gm], edges: [] });
    expect(findDeadCode(g).filter((i) => i.kind === "DEAD_CODE")).toEqual([]);
  });

  test("does not flag exports declared as public API", () => {
    const publicComponent: GraphNode = {
      id: "Component:packages/ui/src/index.ts#Button",
      kind: "Component",
      name: "Button",
      loc: { file: "packages/ui/src/index.ts" },
      meta: { exported: true },
    };
    const internalComponent: GraphNode = {
      id: "Component:packages/ui/src/internal.tsx#Internal",
      kind: "Component",
      name: "Internal",
      loc: { file: "packages/ui/src/internal.tsx" },
      meta: { exported: true },
    };
    const g = buildGraph({ nodes: [publicComponent, internalComponent], edges: [] });
    const dead = findDeadCode(g, {
      publicApi: {
        exports: [{ paths: ["packages/ui/src/index.ts"], names: ["Button"] }],
      },
    }).filter((i) => i.kind === "DEAD_CODE");

    expect(dead.map((i) => i.nodes[0])).toEqual(["Component:packages/ui/src/internal.tsx#Internal"]);
  });
});
