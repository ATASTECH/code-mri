import type { Report } from "@code-mri/shared-types";
import { describe, expect, test } from "vitest";
import { nodeId } from "../ids.js";
import {
  askGraph,
  checkBreakingChanges,
  createAgentQueryContext,
  findDeadCode,
  getNodeContext,
  graphSearch,
  impactQuery,
  planGraphQuestion,
  recommendTests,
} from "./query.js";

const MODEL_FILE = nodeId("File", "backend/users/models.py");
const SERIALIZER_FILE = nodeId("File", "backend/users/serializers.py");
const FIELD = nodeId("Field", "backend/users/models.py", "User", "email");
const SERIALIZER = nodeId("Serializer", "backend/users/serializers.py", "UserSerializer");
const HOOK = nodeId("Hook", "frontend/hooks/useUsers.ts", "useUsersQuery");
const PAGE = nodeId("Page", "frontend/pages/users.tsx", "UsersPage");

function report(overrides: Partial<Report> = {}): Report {
  return {
    schemaVersion: 4,
    project: { name: "demo", root: "/repo", stack: ["next.js", "django"] },
    summary: { files: 3, components: 0, models: 1, endpoints: 1 },
    nodes: [
      {
        id: FIELD,
        kind: "Field",
        name: "email",
        loc: { file: "backend/users/models.py", line: 3 },
      },
      {
        id: SERIALIZER,
        kind: "Serializer",
        name: "UserSerializer",
        loc: { file: "backend/users/serializers.py", line: 2 },
      },
      {
        id: HOOK,
        kind: "Hook",
        name: "useUsersQuery",
        loc: { file: "frontend/hooks/useUsers.ts", line: 5 },
      },
      {
        id: PAGE,
        kind: "Page",
        name: "UsersPage",
        loc: { file: "frontend/pages/users.tsx", line: 2 },
      },
    ],
    edges: [
      { id: `USES:${SERIALIZER}->${FIELD}`, kind: "USES", from: SERIALIZER, to: FIELD },
      { id: `USES:${HOOK}->${FIELD}`, kind: "USES", from: HOOK, to: FIELD },
      { id: `USES:${PAGE}->${HOOK}`, kind: "USES", from: PAGE, to: HOOK },
    ],
    issues: [
      {
        kind: "DEAD_CODE",
        severity: "low",
        message: "Hook is never used",
        nodes: [HOOK],
        candidate: true,
      },
    ],
    scores: { health: 99, breakdown: { DEAD_CODE: 1 } },
    ...overrides,
  };
}

describe("agent report query tools", () => {
  test("runs an impact query with sourced nodes", () => {
    const result = impactQuery(createAgentQueryContext(report()), { query: "email" });

    expect(result.tool).toBe("impact_query");
    expect(result.loc).toEqual({ file: "backend/users/models.py", line: 3 });
    expect(result.candidates?.map((node) => node.id)).toEqual(
      expect.arrayContaining([HOOK, PAGE, SERIALIZER]),
    );
    expect(result.candidates?.find((node) => node.id === HOOK)).toMatchObject({
      confidence: "high",
      loc: { file: "frontend/hooks/useUsers.ts", line: 5 },
    });
  });

  test("searches graph nodes and returns confidence plus loc", () => {
    const result = graphSearch(createAgentQueryContext(report()), { query: "frontend/hooks" });

    expect(result.nodes?.[0]).toMatchObject({
      id: HOOK,
      confidence: "low",
      loc: { file: "frontend/hooks/useUsers.ts", line: 5 },
    });
  });

  test("searches with snake_case queries against camelCase symbols", () => {
    const result = graphSearch(
      createAgentQueryContext(
        report({
          nodes: [
            ...report().nodes,
            {
              id: "Function:engine/src/mcp/server.ts#scanProjectTool",
              kind: "Function",
              name: "scanProjectTool",
              loc: { file: "engine/src/mcp/server.ts", line: 240 },
            },
          ],
        }),
      ),
      { query: "scan_project" },
    );

    expect(result.nodes?.[0]).toMatchObject({
      id: "Function:engine/src/mcp/server.ts#scanProjectTool",
      confidence: "low",
      loc: { file: "engine/src/mcp/server.ts", line: 240 },
    });
  });

  test("expands file-level impact to contained symbols and importer files", () => {
    const result = impactQuery(
      createAgentQueryContext(
        report({
          nodes: [
            {
              id: MODEL_FILE,
              kind: "File",
              name: "backend/users/models.py",
              loc: { file: "backend/users/models.py" },
            },
            {
              id: SERIALIZER_FILE,
              kind: "File",
              name: "backend/users/serializers.py",
              loc: { file: "backend/users/serializers.py" },
            },
            ...report().nodes,
          ],
          edges: [
            { id: `IMPORTS:${SERIALIZER_FILE}->${MODEL_FILE}`, kind: "IMPORTS", from: SERIALIZER_FILE, to: MODEL_FILE },
            ...report().edges,
          ],
        }),
      ),
      { nodeId: MODEL_FILE },
    );

    expect(result.nodes?.map((node) => node.id)).toEqual(expect.arrayContaining([MODEL_FILE, FIELD]));
    expect(result.candidates?.map((node) => node.id)).toEqual(
      expect.arrayContaining([SERIALIZER_FILE, HOOK, PAGE, SERIALIZER]),
    );
    expect(result.message).toContain("expands to 1 symbol");
  });

  test("returns existing dead-code candidates without scanning", () => {
    const result = findDeadCode(createAgentQueryContext(report()));

    expect(result.issues).toEqual([
      expect.objectContaining({
        confidence: "medium",
        loc: { file: "frontend/hooks/useUsers.ts", line: 5 },
      }),
    ]);
  });

  test("returns context edges and direct issues for a node", () => {
    const result = getNodeContext(createAgentQueryContext(report()), { nodeId: HOOK });

    expect(result.edges).toHaveLength(2);
    expect(result.issues).toHaveLength(1);
    expect(result.loc).toEqual({ file: "frontend/hooks/useUsers.ts", line: 5 });
  });

  test("recommends focused tests for changed engine files", () => {
    const result = recommendTests(
      createAgentQueryContext(
        report({
          nodes: [
            ...report().nodes,
            {
              id: "File:engine/src/mcp/server.ts",
              kind: "File",
              name: "engine/src/mcp/server.ts",
              loc: { file: "engine/src/mcp/server.ts" },
            },
            {
              id: "File:engine/src/mcp/server.test.ts",
              kind: "File",
              name: "engine/src/mcp/server.test.ts",
              loc: { file: "engine/src/mcp/server.test.ts" },
            },
          ],
        }),
      ),
      { files: ["engine/src/mcp/server.ts"] },
    );

    expect(result.testCommands?.map((item) => item.command)).toEqual(
      expect.arrayContaining([
        "pnpm --filter @code-mri/engine test -- src/mcp/server.test.ts",
        "pnpm --filter @code-mri/engine typecheck",
        "pnpm --filter @code-mri/engine build",
        "git diff --check",
      ]),
    );
  });

  test("routes natural-language questions deterministically", () => {
    expect(planGraphQuestion({ question: "what is impacted by email?" }).tool).toBe("impact_query");
    expect(planGraphQuestion({ question: "find unused code" }).tool).toBe("find_dead_code");
    expect(planGraphQuestion({ question: "breaking changes var mı" }).tool).toBe("check_breaking_changes");
    expect(planGraphQuestion({ question: "which tests should I run for engine/src/mcp/server.ts?" }).tool).toBe(
      "recommend_tests",
    );

    const result = askGraph(createAgentQueryContext(report()), {
      question: "what is impacted by backend/users/models.py#User#email?",
    });
    expect(result.result?.tool).toBe("impact_query");
    expect(result.plan[0]).toContain("deterministic");
  });

  test("uses a baseline report for breaking-change checks", () => {
    const before = report();
    const after = report({
      nodes: before.nodes.filter((node) => node.id !== FIELD),
      edges: [],
    });
    const result = checkBreakingChanges(createAgentQueryContext(after, before));

    expect(result.confidence).toBe("high");
    expect(result.breakingChanges?.[0]).toMatchObject({
      kind: "BREAKING_FIELD_REMOVED",
      confidence: "high",
      loc: { file: "backend/users/models.py", line: 3 },
    });
  });
});
