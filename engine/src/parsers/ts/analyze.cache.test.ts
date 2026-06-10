import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { scanRepo } from "../../scanner/scan.js";
import { analyzeTypeScript } from "./analyze.js";
import { createMemoryFactsCache } from "./cache.js";

const FIXTURE = fileURLToPath(new URL("../../../test/fixtures/sample-app", import.meta.url));

describe("analyzeTypeScript content-hash cache", () => {
  test("reuses cached facts on a second scan with no new parses", async () => {
    const scan = await scanRepo(FIXTURE);
    const tsFiles = scan.files.filter((f) => f.category === "typescript");
    expect(tsFiles.length).toBeGreaterThan(0);

    const cache = createMemoryFactsCache();

    const first = analyzeTypeScript(scan.root, tsFiles, { cache });
    const afterFirst = cache.stats();

    const second = analyzeTypeScript(scan.root, tsFiles, { cache });
    const afterSecond = cache.stats();

    // Cache-served output must match the freshly parsed output exactly.
    expect(second).toEqual(first);
    // First scan parses every file (all misses); second scan parses none.
    expect(afterFirst.misses).toBe(tsFiles.length);
    expect(afterSecond.misses).toBe(afterFirst.misses);
    expect(afterSecond.hits).toBe(tsFiles.length);
  });
});
