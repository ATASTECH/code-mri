import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { analyzeProject } from "./analyze.js";

const FIXTURE = fileURLToPath(new URL("../../test/fixtures/sample-app", import.meta.url));

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "code-mri-incr-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("analyzeProject incrementalDir", () => {
  test("produces identical reports cold and warm, and persists caches", async () => {
    const plain = await analyzeProject(FIXTURE);

    const cold = await analyzeProject(FIXTURE, { incrementalDir: dir });
    const warm = await analyzeProject(FIXTURE, { incrementalDir: dir });

    expect(cold.report).toEqual(plain.report);
    expect(warm.report).toEqual(plain.report);
    expect(existsSync(path.join(dir, "ts-facts.json"))).toBe(true);
    expect(existsSync(path.join(dir, "py-analysis.json"))).toBe(true);
  });
});
