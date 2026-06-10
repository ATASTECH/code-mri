import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { nodeId } from "../ids.js";
import { analyzeProjectRepos } from "./analyzeRepos.js";

const FIXTURE = fileURLToPath(new URL("../../test/fixtures/sample-app", import.meta.url));

const EMAIL = nodeId("Field", "backend/users/models.py", "User", "email");
const HOOK = nodeId("Hook", "frontend/hooks/useUsers.ts", "useUsersQuery");
const PAGE = nodeId("Page", "frontend/pages/users.tsx", "UsersPage");

const tempRoots: string[] = [];

async function splitFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "code-mri-multi-root-"));
  tempRoots.push(root);

  const frontendRoot = path.join(root, "web");
  const backendRoot = path.join(root, "api");

  await cp(path.join(FIXTURE, "frontend"), frontendRoot, { recursive: true });
  await cp(path.join(FIXTURE, "backend"), backendRoot, { recursive: true });

  return { frontendRoot, backendRoot };
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("analyzeProjectRepos", () => {
  test("scans split frontend/backend repos into one prefixed project report", async () => {
    const { frontendRoot, backendRoot } = await splitFixture();
    const { graph, link, report } = await analyzeProjectRepos({
      projectName: "split-app",
      repos: [
        { id: "frontend", name: "Frontend", root: frontendRoot, role: "frontend" },
        { id: "backend", name: "Backend", root: backendRoot, role: "backend" },
      ],
    });

    expect(report.project.name).toBe("split-app");
    expect(report.project.repos).toHaveLength(2);
    expect(report.project.repos?.map((repo) => repo.id)).toEqual(["frontend", "backend"]);
    expect(report.project.stack).toEqual(
      expect.arrayContaining(["django", "next.js", "typescript"]),
    );

    expect(graph.getNode(EMAIL)?.loc?.file).toBe("backend/users/models.py");
    expect(graph.getNode(HOOK)?.loc?.file).toBe("frontend/hooks/useUsers.ts");
    expect(new Set(graph.impact(EMAIL).map((node) => node.id))).toContain(PAGE);

    expect(
      link.edges.some(
        (edge) =>
          edge.from === HOOK &&
          edge.to.startsWith("APIEndpoint:backend/") &&
          edge.confidence === "high",
      ),
    ).toBe(true);

    expect(report.summary.files).toBeGreaterThan(0);
    expect(report.summary.models).toBe(1);
    expect(report.summary.endpoints).toBeGreaterThan(0);
  });

  test("uses the analyzer registry for multi-repo Express routes and frontend calls", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "code-mri-multi-express-"));
    tempRoots.push(root);
    const frontendRoot = path.join(root, "web");
    const backendRoot = path.join(root, "api");
    await mkdir(path.join(frontendRoot, "src"), { recursive: true });
    await cp(fileURLToPath(new URL("../../test/fixtures/express-app", import.meta.url)), backendRoot, {
      recursive: true,
    });
    await writeFile(
      path.join(frontendRoot, "package.json"),
      JSON.stringify({ dependencies: { react: "latest" } }),
    );
    await writeFile(
      path.join(frontendRoot, "src/users-api.ts"),
      [
        "export const usersApi = {",
        "  list: () => fetch('/users'),",
        "  get: (id: string) => fetch(`/users/${id}`),",
        "};",
      ].join("\n"),
    );

    const { report } = await analyzeProjectRepos({
      projectName: "express-project",
      repos: [
        { id: "frontend", name: "Frontend", root: frontendRoot, role: "frontend" },
        { id: "backend", name: "Backend", root: backendRoot, role: "backend" },
      ],
    });

    const usersEndpoint = report.nodes.find(
      (node) =>
        node.kind === "APIEndpoint" &&
        node.id.startsWith("APIEndpoint:backend/") &&
        node.meta?.method === "GET" &&
        (node.meta?.path === "/users/" || node.meta?.path === "/users"),
    );
    expect(usersEndpoint).toBeDefined();
    expect(
      report.edges.some(
        (edge) =>
          edge.kind === "CALLS" &&
          edge.from === nodeId("File", "frontend/src/users-api.ts") &&
          edge.to === usersEndpoint?.id,
      ),
    ).toBe(true);
  });
});
