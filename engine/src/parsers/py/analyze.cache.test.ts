import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { scanRepo } from "../../scanner/scan.js";
import { analyzePython } from "./analyze.js";
import { createMemoryPyCache } from "./cache.js";

const FIXTURE = fileURLToPath(new URL("../../../test/fixtures/sample-app", import.meta.url));

describe("analyzePython whole-result cache", () => {
  test("reuses the cached analysis when no python file changed", async () => {
    const scan = await scanRepo(FIXTURE);
    const pyFiles = scan.files.filter((f) => f.category === "python").map((f) => f.path);
    expect(pyFiles.length).toBeGreaterThan(0);

    const cache = createMemoryPyCache();
    const first = await analyzePython(scan.root, pyFiles, {}, cache);
    const second = await analyzePython(scan.root, pyFiles, {}, cache);

    expect(second).toEqual(first);
    // First call ran the sidecar (miss); second served from cache (hit).
    expect(cache.stats()).toMatchObject({ hits: 1, misses: 1 });
  });
});
