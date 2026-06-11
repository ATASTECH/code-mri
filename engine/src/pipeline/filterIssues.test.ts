import type { GraphEdge, GraphNode, Issue } from "../types.js";
import { describe, expect, test } from "vitest";
import { parseCodeMriConfig } from "../config/codemri.js";
import { filterIgnoredRiskIssues } from "./filterIssues.js";

const nodes: GraphNode[] = [
  { id: "File:src/app.ts", kind: "File", name: "src/app.ts", loc: { file: "src/app.ts" } },
  { id: "File:examples/demo.ts", kind: "File", name: "examples/demo.ts", loc: { file: "examples/demo.ts" } },
  { id: "Function:src/app.ts#run", kind: "Function", name: "run", loc: { file: "src/app.ts", line: 1 } },
];

function issue(kind: Issue["kind"], nodeIds: string[]): Issue {
  return { kind, severity: "low", message: kind, nodes: nodeIds };
}

describe("filterIgnoredRiskIssues", () => {
  test("drops issues when every referenced file is ignored", () => {
    const config = parseCodeMriConfig({ risk: { ignorePaths: "examples/**" } });
    const issues = [
      issue("DEAD_CODE", ["File:examples/demo.ts"]),
      issue("DEAD_CODE", ["Function:src/app.ts#run"]),
    ];

    expect(filterIgnoredRiskIssues(issues, nodes, config).map((item) => item.nodes)).toEqual([
      ["Function:src/app.ts#run"],
    ]);
  });

  test("keeps issues that cross ignored and non-ignored files", () => {
    const config = parseCodeMriConfig({ risk: { ignorePaths: "examples/**" } });
    const issues = [issue("BOUNDARY_VIOLATION", ["File:examples/demo.ts", "File:src/app.ts"])];

    expect(filterIgnoredRiskIssues(issues, nodes, config)).toHaveLength(1);
  });

  test("resolves files through edges for location-less nodes like API endpoints", () => {
    const config = parseCodeMriConfig({ risk: { ignorePaths: "test/fixtures/**" } });
    const graphNodes: GraphNode[] = [
      ...nodes,
      { id: "APIEndpoint:GET /api/users", kind: "APIEndpoint", name: "GET /api/users" },
      {
        id: "Function:test/fixtures/views.py#list_users",
        kind: "Function",
        name: "list_users",
        loc: { file: "test/fixtures/views.py", line: 1 },
      },
    ];
    const edges: GraphEdge[] = [
      {
        id: "e1",
        kind: "EXPOSES",
        from: "Function:test/fixtures/views.py#list_users",
        to: "APIEndpoint:GET /api/users",
      },
    ];
    const issues = [issue("UNUSED_ENDPOINT", ["APIEndpoint:GET /api/users"])];

    expect(filterIgnoredRiskIssues(issues, graphNodes, config, edges)).toHaveLength(0);
  });

  test("keeps location-less node issues when an edge neighbor is outside ignored paths", () => {
    const config = parseCodeMriConfig({ risk: { ignorePaths: "test/fixtures/**" } });
    const graphNodes: GraphNode[] = [
      ...nodes,
      { id: "APIEndpoint:GET /api/users", kind: "APIEndpoint", name: "GET /api/users" },
    ];
    const edges: GraphEdge[] = [
      { id: "e1", kind: "EXPOSES", from: "Function:src/app.ts#run", to: "APIEndpoint:GET /api/users" },
    ];
    const issues = [issue("UNUSED_ENDPOINT", ["APIEndpoint:GET /api/users"])];

    expect(filterIgnoredRiskIssues(issues, graphNodes, config, edges)).toHaveLength(1);
  });
});
