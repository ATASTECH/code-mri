import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Report } from "../types.js";
import { describe, expect, test } from "vitest";
import { nodeId } from "../ids.js";
import { analyzeProject } from "./analyze.js";

const FIXTURE = fileURLToPath(new URL("../../test/fixtures/sample-app", import.meta.url));
const EXPECTED = fileURLToPath(
  new URL("../../test/fixtures/expected.json", import.meta.url),
);
const OPENAPI = fileURLToPath(new URL("../../test/fixtures/openapi.yaml", import.meta.url));

const EMAIL = nodeId("Field", "backend/users/models.py", "User", "email");
const SER = nodeId("Serializer", "backend/users/serializers.py", "UserSerializer");
const VIEW = nodeId("ViewSet", "backend/users/views.py", "UserViewSet");
const HOOK = nodeId("Hook", "frontend/hooks/useUsers.ts", "useUsersQuery");
const PAGE = nodeId("Page", "frontend/pages/users.tsx", "UsersPage");
const UNUSED = nodeId("Component", "frontend/components/Unused.tsx", "Unused");
const BACKEND_SERVICE = nodeId("DockerService", "docker-compose.yml", "backend");
const POSTGRES_SERVICE = nodeId("DockerService", "docker-compose.yml", "postgres");

function normalizeReport(report: Report): Report {
  return {
    ...report,
    project: {
      ...report.project,
      root: "<fixture>",
    },
  };
}

describe("analyzeProject (end-to-end golden chain)", () => {
  test("impact of User.email reaches the whole stack up to the page", async () => {
    const { graph } = await analyzeProject(FIXTURE);
    const impacted = new Set(graph.impact(EMAIL).map((n) => n.id));
    // Backend → API → frontend, the killer feature:
    for (const id of [SER, VIEW, HOOK, PAGE]) expect(impacted.has(id)).toBe(true);
    expect(graph.edges().some((e) => e.kind === "USES" && e.from === HOOK && e.to === EMAIL)).toBe(true);
  });

  test("links the frontend call to /api/users/ with high confidence", async () => {
    const { link } = await analyzeProject(FIXTURE);
    expect(link.edges.some((e) => e.from === HOOK && e.confidence === "high")).toBe(true);
  });

  test("flags the unused component as a dead-code candidate", async () => {
    const { report } = await analyzeProject(FIXTURE);
    const dead = report.issues.find(
      (i) => i.kind === "DEAD_CODE" && i.nodes.includes(UNUSED),
    );
    expect(dead?.candidate).toBe(true);
  });

  test("applies .codemri.yml boundary rules to report issues", async () => {
    const { report } = await analyzeProject(FIXTURE, {
      config: {
        boundaries: {
          groups: [
            { id: "frontend", paths: ["frontend/**"] },
            { id: "backend", paths: ["backend/**"] },
          ],
          rules: [{ from: ["frontend"], to: ["backend"], allow: false }],
        },
        publicApi: { exports: [] },
        ci: { gates: {} },
        risk: { ignorePaths: [] },
      },
    });
    const boundary = report.issues.find((issue) => issue.kind === "BOUNDARY_VIOLATION");

    expect(boundary).toMatchObject({
      severity: "medium",
      meta: expect.objectContaining({
        fromGroup: "frontend",
        toGroup: "backend",
      }),
    });
    expect(report.scores.breakdown.BOUNDARY_VIOLATION).toBeGreaterThan(0);
  });

  test("produces a stack, summary and an explainable health score", async () => {
    const { report } = await analyzeProject(FIXTURE);
    expect(report.project.stack).toEqual(
      expect.arrayContaining(["django", "next.js", "typescript"]),
    );
    expect(report.summary.models).toBe(1);
    expect(report.scores.health).toBeLessThan(100);
    expect(report.scores.health).toBeGreaterThan(0);
  });

  test("adds docker compose service dependencies to the graph", async () => {
    const { graph } = await analyzeProject(FIXTURE);
    expect(graph.getNode(BACKEND_SERVICE)?.kind).toBe("DockerService");
    expect(
      graph.edges().some((edge) => edge.from === BACKEND_SERVICE && edge.to === POSTGRES_SERVICE),
    ).toBe(true);
  });

  test("adds OpenAPI endpoints when a spec is provided", async () => {
    const { graph } = await analyzeProject(FIXTURE, { openapi: OPENAPI });
    expect(graph.getNode(nodeId("APIEndpoint", "GET /api/health/"))).toMatchObject({
      kind: "APIEndpoint",
      meta: expect.objectContaining({ source: "openapi" }),
    });
  });

  test("matches the full golden report snapshot", async () => {
    const expected = JSON.parse(await readFile(EXPECTED, "utf8")) as Report;
    const { report } = await analyzeProject(FIXTURE);
    expect(normalizeReport(report)).toEqual(expected);
  });
});
