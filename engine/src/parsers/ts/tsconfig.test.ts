import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readTsResolverConfig } from "./tsconfig.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "code-mri-tsconfig-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("readTsResolverConfig", () => {
  it("returns baseUrl and paths from tsconfig.json (comments tolerated)", async () => {
    await writeFile(
      path.join(dir, "tsconfig.json"),
      `{
        // app config
        "compilerOptions": {
          "baseUrl": ".",
          "paths": { "@/*": ["src/*"] }
        }
      }`,
    );

    const cfg = readTsResolverConfig(dir);
    expect(cfg.paths).toEqual({ "@/*": ["src/*"] });
    expect(cfg.baseUrl).toBe(".");
  });

  it("returns undefined baseUrl and empty paths when no tsconfig exists", () => {
    const cfg = readTsResolverConfig(dir);
    expect(cfg.baseUrl).toBeUndefined();
    expect(cfg.paths).toEqual({});
  });
});
