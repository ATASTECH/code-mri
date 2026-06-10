import type { GraphEdge, GraphNode } from "@code-mri/shared-types";
import { describe, expect, test } from "vitest";
import { buildGraph } from "../graph/build.js";
import { findBoundaryViolations } from "./boundaries.js";

const file = (id: string, path: string): GraphNode => ({
  id,
  kind: "File",
  name: path,
  loc: { file: path },
});

const edge = (kind: GraphEdge["kind"], from: string, to: string): GraphEdge => ({
  id: `${kind}:${from}->${to}`,
  from,
  to,
  kind,
});

describe("findBoundaryViolations", () => {
  test("reports deny-rule dependency violations", () => {
    const graph = buildGraph({
      nodes: [file("web", "apps/web/page.tsx"), file("db", "packages/db/client.ts")],
      edges: [edge("IMPORTS", "web", "db")],
    });

    const issues = findBoundaryViolations(graph, {
      groups: [
        { id: "web", paths: ["apps/web/**"] },
        { id: "db", paths: ["packages/db/**"] },
      ],
      rules: [{ from: ["web"], to: ["db"], allow: false }],
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      kind: "BOUNDARY_VIOLATION",
      severity: "medium",
      nodes: ["web", "db"],
      meta: expect.objectContaining({
        fromGroup: "web",
        toGroup: "db",
        edgeKind: "IMPORTS",
        rule: "deny",
      }),
    });
  });

  test("treats allow rules as a whitelist for declared target groups", () => {
    const graph = buildGraph({
      nodes: [
        file("web", "apps/web/page.tsx"),
        file("api", "packages/api/users.ts"),
        file("db", "packages/db/client.ts"),
      ],
      edges: [edge("IMPORTS", "web", "api"), edge("IMPORTS", "web", "db")],
    });

    const issues = findBoundaryViolations(graph, {
      groups: [
        { id: "web", paths: ["apps/web/**"] },
        { id: "api", paths: ["packages/api/**"] },
        { id: "db", paths: ["packages/db/**"] },
      ],
      rules: [{ from: ["web"], to: ["api"], allow: true }],
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.nodes).toEqual(["web", "db"]);
    expect(issues[0]?.meta).toMatchObject({
      fromGroup: "web",
      toGroup: "db",
      rule: "allow",
      allowedTo: "api",
    });
  });

  test("ignores non-dependency edge kinds unless explicitly configured", () => {
    const graph = buildGraph({
      nodes: [file("api", "packages/api/users.ts"), file("route", "apps/web/route.ts")],
      edges: [edge("EXPOSES", "api", "route")],
    });

    const config = {
      groups: [
        { id: "api", paths: ["packages/api/**"] },
        { id: "web", paths: ["apps/web/**"] },
      ],
      rules: [{ from: ["api"], to: ["web"], allow: false }],
    };

    expect(findBoundaryViolations(graph, config)).toEqual([]);
    expect(
      findBoundaryViolations(graph, {
        ...config,
        rules: [{ ...config.rules[0]!, edgeKinds: ["EXPOSES"] }],
      }),
    ).toHaveLength(1);
  });
});
