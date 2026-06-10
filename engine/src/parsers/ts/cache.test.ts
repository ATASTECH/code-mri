import { describe, expect, it } from "vitest";
import { createMemoryFactsCache, hashContent } from "./cache.js";
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

describe("hashContent", () => {
  it("is stable for identical content and differs for changed content", () => {
    expect(hashContent("const a = 1")).toBe(hashContent("const a = 1"));
    expect(hashContent("const a = 1")).not.toBe(hashContent("const a = 2"));
  });
});

describe("createMemoryFactsCache", () => {
  it("round-trips a stored entry and counts a hit", () => {
    const cache = createMemoryFactsCache();
    cache.set("a.ts", "h1", facts("a.ts"));

    expect(cache.get("a.ts", "h1")).toEqual(facts("a.ts"));
    expect(cache.stats()).toMatchObject({ hits: 1, misses: 0, size: 1 });
  });

  it("misses when the content hash differs", () => {
    const cache = createMemoryFactsCache();
    cache.set("a.ts", "h1", facts("a.ts"));

    expect(cache.get("a.ts", "h2")).toBeUndefined();
    expect(cache.stats()).toMatchObject({ hits: 0, misses: 1 });
  });
});
