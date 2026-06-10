import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { analyzeTypeScript } from "./analyze.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "code-mri-sizeguard-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function write(rel: string, content: string): Promise<{ path: string; abs: string }> {
  const abs = path.join(dir, rel);
  await writeFile(abs, content);
  return { path: rel, abs };
}

describe("analyzeTypeScript parse size guard", () => {
  it("skips parsing files larger than maxParseBytes but still parses small ones", async () => {
    const files = [
      await write("Small.tsx", `export function Small() { return <i />; }\n`),
      await write(
        "Big.tsx",
        `export function Big() { return <i />; }\n// ${"x".repeat(500)}\n`,
      ),
    ];

    const { nodes } = analyzeTypeScript(dir, files, { maxParseBytes: 200 });
    const declNames = nodes.filter((n) => n.kind !== "File").map((n) => n.name);

    expect(declNames).toContain("Small"); // under threshold → parsed
    expect(declNames).not.toContain("Big"); // over threshold → skipped
  });
});
