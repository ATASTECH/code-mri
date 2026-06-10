import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { scanRepo } from "../../scanner/scan.js";
import { nodeId } from "../../ids.js";
import { analyzeTypeScript } from "./analyze.js";
import { readWorkspacePackages } from "./workspace.js";

const FIXTURE = fileURLToPath(new URL("../../../test/fixtures/monorepo-app", import.meta.url));

async function scan() {
  return scanRepo(FIXTURE);
}

describe("readWorkspacePackages", () => {
  test("maps each named package.json to its dir and entry", async () => {
    const s = await scan();
    const pkgs = readWorkspacePackages(
      s.root,
      s.files.map((f) => f.path),
    );
    expect(pkgs).toEqual(
      expect.arrayContaining([
        { name: "@acme/ui", dir: "packages/ui", entry: "index.ts" },
        { name: "@acme/web", dir: "apps/web", entry: undefined },
      ]),
    );
  });
});

describe("analyzeTypeScript - monorepo workspace imports", () => {
  test("resolves a cross-package `@acme/ui` import to the package entry file", async () => {
    const s = await scan();
    const tsFiles = s.files.filter((f) => f.category === "typescript");
    const packageJsonPaths = s.files
      .filter((f) => f.path.endsWith("package.json"))
      .map((f) => f.path);
    const a = analyzeTypeScript(s.root, tsFiles, { packageJsonPaths });

    const has = (from: string, to: string) =>
      a.edges.some(
        (e) =>
          e.kind === "IMPORTS" && e.from === nodeId("File", from) && e.to === nodeId("File", to),
      );
    expect(has("apps/web/src/App.tsx", "packages/ui/index.ts")).toBe(true);
  });

  test("follows the package entry's re-export to render the real component", async () => {
    const s = await scan();
    const tsFiles = s.files.filter((f) => f.category === "typescript");
    const packageJsonPaths = s.files
      .filter((f) => f.path.endsWith("package.json"))
      .map((f) => f.path);
    const a = analyzeTypeScript(s.root, tsFiles, { packageJsonPaths });

    const app = nodeId("Component", "apps/web/src/App.tsx", "App");
    const button = nodeId("Component", "packages/ui/Button.tsx", "Button");
    expect(a.edges.some((e) => e.kind === "RENDERS" && e.from === app && e.to === button)).toBe(
      true,
    );
  });
});
