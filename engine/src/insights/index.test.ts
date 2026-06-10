import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { buildGraph } from "../graph/build.js";
import { edgeId, nodeId } from "../ids.js";
import { buildInsights } from "./index.js";

const tempRoots: string[] = [];

async function tempRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "code-mri-insights-"));
  tempRoots.push(root);
  await mkdir(path.join(root, "src"), { recursive: true });
  return root;
}

function git(root: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: root, stdio: "ignore" });
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("buildInsights", () => {
  test("collects git churn, coverage, secrets, hotspots, and explanations", async () => {
    const root = await tempRepo();
    const hotFile = path.join(root, "src/hot.ts");
    const secretFile = path.join(root, "src/config.ts");
    await writeFile(
      hotFile,
      "export function risky(a: boolean, b: boolean) {\n  if (a && b) {\n    for (const x of [1, 2]) console.log(x)\n  }\n}\n",
    );
    await writeFile(secretFile, 'export const API_TOKEN = "abc123abc123abc123"\n');

    git(root, "init");
    git(root, "config", "user.email", "code-mri@example.test");
    git(root, "config", "user.name", "Code MRI");
    git(root, "add", ".");
    git(root, "commit", "-m", "initial");
    await writeFile(
      hotFile,
      "export function risky(a: boolean, b: boolean) {\n  if (a && b) {\n    for (const x of [1, 2, 3]) console.log(x)\n  }\n}\n",
    );
    git(root, "add", ".");
    git(root, "commit", "-m", "touch hotspot");

    await mkdir(path.join(root, "coverage"), { recursive: true });
    await writeFile(
      path.join(root, "coverage/lcov.info"),
      ["TN:", `SF:${hotFile}`, "DA:1,1", "DA:2,0", "DA:3,1", "end_of_record"].join("\n"),
    );

    const fileId = nodeId("File", "src/hot.ts");
    const compId = nodeId("Component", "src/hot.ts", "risky");
    const graph = buildGraph({
      nodes: [
        { id: fileId, kind: "File", name: "src/hot.ts", loc: { file: "src/hot.ts" } },
        { id: compId, kind: "Component", name: "risky", loc: { file: "src/hot.ts" } },
        {
          id: nodeId("File", "src/config.ts"),
          kind: "File",
          name: "src/config.ts",
          loc: { file: "src/config.ts" },
        },
      ],
      edges: [
        {
          id: edgeId("USES", compId, fileId),
          from: compId,
          to: fileId,
          kind: "USES",
        },
      ],
    });

    const result = buildInsights({
      graph,
      repos: [
        {
          root,
          files: [
            {
              path: "src/hot.ts",
              graphPath: "src/hot.ts",
              abs: hotFile,
              category: "typescript",
            },
            {
              path: "src/config.ts",
              graphPath: "src/config.ts",
              abs: secretFile,
              category: "typescript",
            },
          ],
        },
      ],
    });

    expect(result.insights.churn).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: "src/hot.ts", commits: 2, authors: 1 }),
      ]),
    );
    expect(result.insights.coverage).toEqual([
      expect.objectContaining({ file: "src/hot.ts", total: 3, covered: 2, pct: 66.7 }),
    ]);
    expect(result.insights.secrets).toEqual([
      expect.objectContaining({
        file: "src/config.ts",
        line: 1,
        rule: "secret-assignment",
        preview: "abc1...c123",
      }),
    ]);
    expect(result.insights.hotspots[0]).toEqual(
      expect.objectContaining({
        nodeId: compId,
        churn: 2,
        coveragePct: 66.7,
      }),
    );
    expect(result.nodes.find((node) => node.id === compId)?.meta).toEqual(
      expect.objectContaining({
        churn: 2,
        coveragePct: 66.7,
        hotspotScore: expect.any(Number),
      }),
    );
    expect(result.issues.map((issue) => issue.kind)).toContain("SECRET_CANDIDATE");
    expect(result.insights.explanations.map((item) => item.id)).toContain("top-hotspot");
    expect(result.insights.dependencyAudit?.status).toBe("not_run");
  });

  test("no-ops git churn outside a git repository", async () => {
    const root = await tempRepo();
    const file = path.join(root, "src/plain.ts");
    await writeFile(file, "export const plain = 1\n");
    const graph = buildGraph({
      nodes: [
        { id: nodeId("File", "src/plain.ts"), kind: "File", name: "src/plain.ts", loc: { file: "src/plain.ts" } },
      ],
      edges: [],
    });

    const result = buildInsights({
      graph,
      repos: [
        {
          root,
          files: [{ path: "src/plain.ts", graphPath: "src/plain.ts", abs: file, category: "typescript" }],
        },
      ],
    });

    expect(result.insights.churn).toEqual([]);
    expect(result.issues).toEqual([]);
  });

  test("does not treat TypeScript secret-shaped type annotations as secrets", async () => {
    const root = await tempRepo();
    const file = path.join(root, "src/types.ts");
    await writeFile(file, "interface Props {\n  secrets: SecretFinding[]\n  tokenPreview: string\n}\n");
    const graph = buildGraph({
      nodes: [
        { id: nodeId("File", "src/types.ts"), kind: "File", name: "src/types.ts", loc: { file: "src/types.ts" } },
      ],
      edges: [],
    });

    const result = buildInsights({
      graph,
      repos: [
        {
          root,
          files: [{ path: "src/types.ts", graphPath: "src/types.ts", abs: file, category: "typescript" }],
        },
      ],
    });

    expect(result.insights.secrets).toEqual([]);
  });
});
