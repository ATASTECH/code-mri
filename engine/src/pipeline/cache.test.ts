import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { createMemoryFactsCache } from "../parsers/ts/cache.js";
import { analyzeProject } from "./analyze.js";

const FIXTURE = fileURLToPath(new URL("../../test/fixtures/sample-app", import.meta.url));

describe("analyzeProject cache option", () => {
  test("threads the facts cache to the TS analyzer across scans", async () => {
    const cache = createMemoryFactsCache();

    await analyzeProject(FIXTURE, { cache });
    const after1 = cache.stats();

    await analyzeProject(FIXTURE, { cache });
    const after2 = cache.stats();

    expect(after1.misses).toBeGreaterThan(0); // first scan parsed real files
    expect(after2.misses).toBe(after1.misses); // second scan re-parsed nothing
    expect(after2.hits).toBeGreaterThan(after1.hits);
  });
});
