import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { Report } from "../types.js";
import { describe, expect, test } from "vitest";
import { nodeId } from "../ids.js";
import {
  askGraph,
  checkBreakingChanges,
  createAgentQueryContext,
  finalizeAgentResult,
  findDeadCode,
  getNodeContext,
  graphSearch,
  impactQuery,
  planGraphQuestion,
  prepareEditContext,
  readWindows,
  recommendTests,
  reviewDiff,
  tokenSavingsReport,
  type AgentNodeReference,
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

  test("paginates public graph helper results and preserves follow-up arguments", () => {
    const ctx = createAgentQueryContext(
      report({
        nodes: Array.from({ length: 12 }, (_, index) => ({
          id: `Component:src/App${index}.tsx#App${index}`,
          kind: "Component",
          name: `App${index}`,
          loc: { file: `src/App${index}.tsx`, line: 1 },
        })),
      }),
    );

    const first = graphSearch(ctx, { query: "App", limit: 4 });
    expect(first.nodes).toHaveLength(4);
    expect(first.resultStats?.nextCursor).toBe("nodes:4");
    expect(first.nextQueries?.[0]?.arguments).toMatchObject({
      query: "App",
      cursor: "nodes:4",
      limit: 8,
    });

    const second = graphSearch(ctx, { query: "App", limit: 4, cursor: "nodes:4" });
    expect(second.nodes?.[0]?.id).not.toBe(first.nodes?.[0]?.id);
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

  test("promotes nested ask_graph pagination cursor to top-level stats", () => {
    const ctx = createAgentQueryContext(
      report({
        nodes: Array.from({ length: 12 }, (_, index) => ({
          id: `Component:src/App${index}.tsx#App${index}`,
          kind: "Component",
          name: `App${index}`,
          loc: { file: `src/App${index}.tsx`, line: 1 },
        })),
      }),
    );

    const result = askGraph(ctx, { question: "App", limit: 4 });

    expect(result.result?.resultStats?.nextCursor).toBe("nodes:4");
    expect(result.resultStats?.nextCursor).toBe("nodes:4");
    expect(result.nextQueries?.[0]?.tool).toBe("graph_search");
    expect(result.nextQueries?.[0]?.arguments).toMatchObject({ query: "App", cursor: "nodes:4" });
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

  test("prepares token-budgeted edit context without reading source", () => {
    const result = prepareEditContext(createAgentQueryContext(report()), {
      task: "change email field behavior",
      files: ["backend/users/models.py"],
      tokenBudget: 1200,
    });

    expect(result.mustRead?.[0]).toMatchObject({
      file: "backend/users/models.py",
      reason: expect.stringContaining("change email field behavior"),
    });
    expect(result.impacts?.map((node) => node.id)).toEqual(expect.arrayContaining([HOOK, PAGE]));
    expect(result.testPlan?.map((item) => item.command)).toContain("git diff --check");
    expect(result.nextQueries?.map((item) => item.tool)).toContain("read_windows");
  });

  test("uses high-risk issue messages when preparing edit context", () => {
    const result = prepareEditContext(
      createAgentQueryContext(
        report({
          issues: [
            ...report().issues,
            {
              kind: "BOUNDARY_VIOLATION",
              severity: "high",
              message: "Danger boundary around users page",
              nodes: [PAGE],
            },
          ],
        }),
      ),
      { task: "danger boundary", tokenBudget: 1200 },
    );

    expect(result.mustRead?.map((window) => window.file)).toContain("frontend/pages/users.tsx");
    expect(result.mustRead?.find((window) => window.file === "frontend/pages/users.tsx")?.reasonCode).toBe(
      "breaking-risk",
    );
    expect(result.risks?.map((issue) => issue.kind)).toContain("BOUNDARY_VIOLATION");
  });

  test("uses hotspot signals when preparing edit context", () => {
    const result = prepareEditContext(
      createAgentQueryContext(
        report({
          insights: {
            churn: [],
            coverage: [],
            secrets: [],
            explanations: [],
            dependencyAudit: { status: "not_run", reason: "test" },
            hotspots: [
              {
                nodeId: HOOK,
                kind: "Hook",
                name: "User hot path",
                file: "frontend/hooks/useUsers.ts",
                churn: 5,
                authors: 2,
                complexity: 8,
                fanIn: 1,
                fanOut: 3,
                impact: 4,
                score: 99,
              },
            ],
          },
        }),
      ),
      { task: "user hot path", tokenBudget: 1200 },
    );

    expect(result.mustRead?.map((window) => window.file)).toContain("frontend/hooks/useUsers.ts");
    expect(result.mustRead?.find((window) => window.file === "frontend/hooks/useUsers.ts")?.reasonCode).toBe(
      "hotspot",
    );
  });

  test("reads bounded source windows only when source is requested and redacts secret lines", () => {
    const root = mkdtempSync(path.join(tmpdir(), "code-mri-agent-"));
    try {
      const src = path.join(root, "src");
      mkdirSync(src, { recursive: true });
      writeFileSync(
        path.join(src, "config.ts"),
        [
          "export const ok = true;",
          "const token = 'ghp_123456789012345678901234567890abcd';",
          "export const done = true;",
        ].join("\n"),
      );
      const ctx = createAgentQueryContext(
        report({
          project: { name: "demo", root, stack: ["typescript"] },
          nodes: [
            {
              id: "File:src/config.ts",
              kind: "File",
              name: "src/config.ts",
              loc: { file: "src/config.ts" },
            },
          ],
          insights: {
            churn: [],
            coverage: [],
            hotspots: [],
            explanations: [],
            dependencyAudit: { status: "not_run", reason: "test" },
            secrets: [
              {
                file: "src/config.ts",
                line: 2,
                column: 15,
                rule: "github-token",
                preview: "ghp_...abcd",
              },
            ],
          },
        }),
      );

      const locationOnly = readWindows(ctx, {
        windows: [{ file: "src/config.ts", startLine: 1, endLine: 3, reason: "test", confidence: "high" }],
        mode: "locations",
      });
      expect(locationOnly.windows?.[0]?.source).toBeUndefined();

      const withSource = readWindows(ctx, {
        windows: [{ file: "src/config.ts", startLine: 1, endLine: 3, reason: "test", confidence: "high" }],
        maxChars: 1000,
      });
      expect(withSource.windows?.[0]?.source).toContain("export const ok");
      expect(withSource.windows?.[0]?.source).toContain("[REDACTED secret candidate: github-token]");
      expect(withSource.windows?.[0]?.source).not.toContain("ghp_123456789012345678901234567890abcd");
      expect(withSource.windows?.[0]?.sha1).toMatch(/^[a-f0-9]{40}$/);

      const budgeted = readWindows(ctx, {
        windows: [{ file: "src/config.ts", startLine: 1, endLine: 3, reason: "test", confidence: "high" }],
        tokenBudget: 120,
      });
      expect(budgeted.resultStats?.estimatedTokens).toBeLessThanOrEqual(120);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("outline mode keeps Python def/class/decorator lines", () => {
    const root = mkdtempSync(path.join(tmpdir(), "code-mri-agent-"));
    try {
      mkdirSync(path.join(root, "api"), { recursive: true });
      writeFileSync(
        path.join(root, "api", "users.py"),
        [
          "import os",
          "",
          '@app.get("/users")',
          "def list_users():",
          "    return []",
          "",
          "class UserService:",
          "    async def get(self):",
          "        return None",
        ].join("\n"),
      );
      const ctx = createAgentQueryContext(
        report({
          project: { name: "demo", root, stack: ["python"] },
          nodes: [{ id: "File:api/users.py", kind: "File", name: "api/users.py", loc: { file: "api/users.py" } }],
        }),
      );

      const outline = readWindows(ctx, {
        windows: [{ file: "api/users.py", startLine: 1, endLine: 9, reason: "test", confidence: "high" }],
        mode: "outline",
      });
      const source = outline.windows?.[0]?.source ?? "";
      expect(source).toContain("def list_users():");
      expect(source).toContain('@app.get("/users")');
      expect(source).toContain("class UserService:");
      expect(source).toContain("async def get(self):");
      expect(source).not.toContain("return []");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("nextQueries arguments are capped and never embed large input arrays", () => {
    const nodes: AgentNodeReference[] = Array.from({ length: 20 }, (_, index) => ({
      id: `File:src/file-${index}.ts`,
      kind: "File",
      name: `src/file-${index}.ts`,
      loc: { file: `src/file-${index}.ts` },
      confidence: "high",
      evidence: [],
    }));
    const fatWindows = Array.from({ length: 40 }, (_, index) => ({
      file: `src/very/long/path/to/some/module/file-${index}.ts`,
      startLine: 1,
      endLine: 80,
      reason: "a fairly long reason string that inflates the serialized input payload",
      confidence: "high" as const,
    }));

    const result = finalizeAgentResult(
      { tool: "read_windows", plan: [], confidence: "high", loc: null, nodes },
      { limit: 3, windows: fatWindows } as Parameters<typeof finalizeAgentResult>[1],
    );

    expect(result.resultStats?.omitted.nodes).toBeGreaterThan(0);
    expect(result.nextQueries?.length).toBeGreaterThan(0);
    for (const next of result.nextQueries ?? []) {
      expect(JSON.stringify(next.arguments).length).toBeLessThanOrEqual(400);
    }
  });

  test("reviews diffs and estimates window token savings", () => {
    const root = mkdtempSync(path.join(tmpdir(), "code-mri-agent-"));
    try {
      mkdirSync(path.join(root, "engine/src/mcp"), { recursive: true });
      writeFileSync(path.join(root, "engine/src/mcp/server.ts"), "a\n".repeat(200));
      const ctx = createAgentQueryContext(
        report({
          project: { name: "demo", root, stack: ["typescript"] },
          nodes: [
            {
              id: "File:engine/src/mcp/server.ts",
              kind: "File",
              name: "engine/src/mcp/server.ts",
              loc: { file: "engine/src/mcp/server.ts" },
            },
          ],
        }),
      );

      const review = reviewDiff(ctx, {
        diffText: "diff --git a/engine/src/mcp/server.ts b/engine/src/mcp/server.ts\n+++ b/engine/src/mcp/server.ts",
      });
      expect(review.safeToProceed).toBe(true);
      expect(review.verificationCommands?.map((item) => item.command)).toEqual(
        expect.arrayContaining(["pnpm --filter @code-mri/engine typecheck", "git diff --check"]),
      );

      const savings = tokenSavingsReport(ctx, {
        files: ["engine/src/mcp/server.ts"],
        windows: [{ file: "engine/src/mcp/server.ts", startLine: 1, endLine: 5, reason: "test", confidence: "high" }],
      });
      expect(savings.tokenSavings?.avoidedBytes).toBeGreaterThan(0);
      expect(savings.tokenSavings?.estimatedTokensAvoided).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
