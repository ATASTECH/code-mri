import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDiskFactsCache } from "./cache.js";
import type { TsFileFacts } from "./facts.js";

const facts = (rel: string): TsFileFacts => ({
  rel,
  decls: [],
  fileApiCalls: [],
  types: [],
  contexts: [],
  imports: [],
  reExports: [],
  dynamicImports: [],
  axiosClients: {},
});

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "code-mri-cache-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("createDiskFactsCache", () => {
  it("persists entries across instances after flush", () => {
    const file = path.join(dir, "nested", "cache.json");

    const a = createDiskFactsCache(file);
    a.set("x.ts", "h1", facts("x.ts"));
    a.flush();

    const b = createDiskFactsCache(file);
    expect(b.get("x.ts", "h1")).toEqual(facts("x.ts"));
  });

  it("compacts stale entries on flush (only entries touched this run are kept)", async () => {
    const file = path.join(dir, "cache.json");

    const a = createDiskFactsCache(file);
    a.set("keep.ts", "h1", facts("keep.ts"));
    a.set("stale.ts", "h1", facts("stale.ts"));
    a.flush();

    // Next run touches only keep.ts (stale.ts is no longer scanned).
    const b = createDiskFactsCache(file);
    expect(b.get("keep.ts", "h1")).toEqual(facts("keep.ts"));
    b.flush();

    const c = createDiskFactsCache(file);
    expect(c.get("keep.ts", "h1")).toEqual(facts("keep.ts"));
    expect(c.get("stale.ts", "h1")).toBeUndefined();
  });

  it("ignores a cache file with a mismatched schema version", async () => {
    const file = path.join(dir, "cache.json");
    await writeFile(
      file,
      JSON.stringify({ version: -1, entries: { "x.ts h1": facts("x.ts") } }),
    );

    const cache = createDiskFactsCache(file);
    expect(cache.get("x.ts", "h1")).toBeUndefined();
  });
});
