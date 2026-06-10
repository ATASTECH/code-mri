import { existsSync } from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { analyzeProjectRepos, type MultiRepoProjectInput } from "./analyzeRepos.js";

const FIXTURE = fileURLToPath(new URL("../../test/fixtures/sample-app", import.meta.url));
const tempRoots: string[] = [];

async function splitFixture(): Promise<MultiRepoProjectInput> {
  const root = await mkdtemp(path.join(tmpdir(), "code-mri-incr-multi-"));
  tempRoots.push(root);
  const frontendRoot = path.join(root, "web");
  const backendRoot = path.join(root, "api");
  await cp(path.join(FIXTURE, "frontend"), frontendRoot, { recursive: true });
  await cp(path.join(FIXTURE, "backend"), backendRoot, { recursive: true });
  return {
    projectName: "split-app",
    repos: [
      { id: "frontend", name: "Frontend", root: frontendRoot, role: "frontend" },
      { id: "backend", name: "Backend", root: backendRoot, role: "backend" },
    ],
  };
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

describe("analyzeProjectRepos incrementalDir", () => {
  test("identical reports cold and warm with per-repo persisted caches", async () => {
    const input = await splitFixture();
    const dir = await mkdtemp(path.join(tmpdir(), "code-mri-incr-cache-"));
    tempRoots.push(dir);

    const plain = await analyzeProjectRepos(input);
    const cold = await analyzeProjectRepos(input, { incrementalDir: dir });
    const warm = await analyzeProjectRepos(input, { incrementalDir: dir });

    expect(cold.report).toEqual(plain.report);
    expect(warm.report).toEqual(plain.report);
    expect(existsSync(path.join(dir, "frontend", "ts-facts.json"))).toBe(true);
    expect(existsSync(path.join(dir, "backend", "py-analysis.json"))).toBe(true);
  });
});
