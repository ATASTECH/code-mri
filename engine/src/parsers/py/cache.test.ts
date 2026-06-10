import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDiskPyCache, createMemoryPyCache, pyFilesDigest } from "./cache.js";
import type { PyAnalysis } from "./assemble.js";

const analysis = (): PyAnalysis => ({ nodes: [], edges: [], routes: [] });

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "code-mri-pycache-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("pyFilesDigest", () => {
  it("is stable for unchanged files and changes when content changes", async () => {
    await writeFile(path.join(dir, "a.py"), "x = 1\n");
    await writeFile(path.join(dir, "b.py"), "y = 2\n");

    const first = pyFilesDigest(dir, ["a.py", "b.py"]);
    expect(pyFilesDigest(dir, ["a.py", "b.py"])).toBe(first);

    await writeFile(path.join(dir, "a.py"), "x = 99\n");
    expect(pyFilesDigest(dir, ["a.py", "b.py"])).not.toBe(first);
  });

  it("does not collide a present sentinel-content file with a missing file", async () => {
    await writeFile(path.join(dir, "a.py"), "x = 1\n");
    await writeFile(path.join(dir, "b.py"), " missing");
    const present = pyFilesDigest(dir, ["a.py", "b.py"]);

    await rm(path.join(dir, "b.py"));
    const missing = pyFilesDigest(dir, ["a.py", "b.py"]);

    expect(present).not.toBe(missing);
  });

  it("is order-independent", async () => {
    await writeFile(path.join(dir, "a.py"), "x = 1\n");
    await writeFile(path.join(dir, "b.py"), "y = 2\n");

    expect(pyFilesDigest(dir, ["a.py", "b.py"])).toBe(
      pyFilesDigest(dir, ["b.py", "a.py"]),
    );
  });
});

describe("createDiskPyCache", () => {
  it("compacts stale digests on flush, keeping only the touched one", () => {
    const file = path.join(dir, "py.json");

    const a = createDiskPyCache(file);
    a.set("old-digest", analysis());
    a.flush();

    const b = createDiskPyCache(file);
    b.set("new-digest", analysis()); // new file-set state; old one not touched
    b.flush();

    const c = createDiskPyCache(file);
    expect(c.get("new-digest")).toEqual(analysis());
    expect(c.get("old-digest")).toBeUndefined();
  });
});

describe("createMemoryPyCache", () => {
  it("round-trips a whole-result entry and counts hits/misses", () => {
    const cache = createMemoryPyCache();
    expect(cache.get("d1")).toBeUndefined();
    cache.set("d1", analysis());

    expect(cache.get("d1")).toEqual(analysis());
    expect(cache.stats()).toMatchObject({ hits: 1, misses: 1 });
  });
});
