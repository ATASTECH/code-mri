import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { loadCodeMriConfig, parseCodeMriConfig } from "./codemri.js";

describe("Code MRI config", () => {
  test("normalizes boundary groups, rules, and public API exports", () => {
    const config = parseCodeMriConfig({
      boundaries: {
        groups: {
          ui: ["apps/ui/**"],
          db: { paths: "packages/db/**" },
        },
        rules: [
          { from: "ui", to: "db", allow: false, edgeKinds: ["IMPORTS"] },
          { from: "ui", to: ["ui", "api"], type: "allow" },
        ],
      },
      publicApi: {
        exports: [
          "packages/ui/src/index.ts#Button",
          { path: "packages/hooks/**", names: ["usePublic"], kind: "Hook" },
        ],
      },
      ci: {
        gates: {
          minHealth: 85,
          maxNewIssues: 0,
          forbidBreakingChanges: true,
          forbidBoundaryViolations: true,
          minCoveragePct: 80,
        },
      },
      risk: {
        ignorePaths: ["examples/**", "**/*.test.ts"],
      },
    });

    expect(config.boundaries.groups).toEqual([
      { id: "ui", paths: ["apps/ui/**"] },
      { id: "db", paths: ["packages/db/**"] },
    ]);
    expect(config.boundaries.rules).toEqual([
      { from: ["ui"], to: ["db"], allow: false, edgeKinds: ["IMPORTS"] },
      { from: ["ui"], to: ["ui", "api"], allow: true },
    ]);
    expect(config.publicApi.exports).toEqual([
      { paths: ["packages/ui/src/index.ts"], names: ["Button"] },
      { paths: ["packages/hooks/**"], names: ["usePublic"], kinds: ["Hook"] },
    ]);
    expect(config.ci.gates).toEqual({
      minHealth: 85,
      maxNewIssues: 0,
      forbidBreakingChanges: true,
      forbidBoundaryViolations: true,
      minCoveragePct: 80,
    });
    expect(config.risk.ignorePaths).toEqual(["examples/**", "**/*.test.ts"]);
  });

  test("discovers .codemri.yml from parent directories", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "code-mri-config-"));
    const project = path.join(root, "project");
    const nested = path.join(project, "apps", "web");
    await mkdir(nested, { recursive: true });
    const configPath = path.join(project, ".codemri.yml");
    await writeFile(
      configPath,
      [
        "boundaries:",
        "  groups:",
        "    web:",
        "      paths: apps/web/**",
        "  rules:",
        "    - from: web",
        "      to: db",
        "      allow: false",
      ].join("\n"),
    );

    const config = loadCodeMriConfig({ root: nested });
    expect(config.sourcePath).toBe(configPath);
    expect(config.boundaries.groups[0]).toEqual({ id: "web", paths: ["apps/web/**"] });
  });
});
