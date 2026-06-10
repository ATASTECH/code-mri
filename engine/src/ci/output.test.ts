import type { Report, ReportDiff } from "@code-mri/shared-types";
import { describe, expect, test } from "vitest";
import { formatCiMarkdown } from "./markdown.js";
import { formatSarif } from "./sarif.js";

const report: Report = {
  schemaVersion: 4,
  project: { name: "demo", root: "/repo", stack: [] },
  summary: { files: 1, components: 1, models: 0, endpoints: 0 },
  nodes: [
    { id: "File:src/a.ts", kind: "File", name: "src/a.ts", loc: { file: "src/a.ts", line: 1 } },
    {
      id: "Component:src/a.ts#App",
      kind: "Component",
      name: "App",
      loc: { file: "src/a.ts", line: 2 },
    },
  ],
  edges: [{ id: "RENDERS:File:src/a.ts->Component:src/a.ts#App", kind: "RENDERS", from: "File:src/a.ts", to: "Component:src/a.ts#App" }],
  issues: [
    {
      kind: "DEAD_CODE",
      severity: "low",
      message: "App is unused",
      nodes: ["Component:src/a.ts#App"],
      candidate: true,
    },
  ],
  scores: { health: 99, breakdown: { DEAD_CODE: 1 } },
};

const diff: ReportDiff = {
  beforeProject: "old",
  afterProject: "demo",
  summary: {
    beforeSchemaVersion: 4,
    afterSchemaVersion: 4,
    healthDelta: -1,
    nodesAdded: 1,
    nodesRemoved: 0,
    nodesChanged: 0,
    edgesAdded: 1,
    edgesRemoved: 0,
    issuesAdded: 1,
    issuesRemoved: 0,
    breakingChanges: 0,
  },
  changes: [
    {
      kind: "node_added",
      id: "Component:src/a.ts#App",
      label: "Component App",
      after: report.nodes[1],
    },
    {
      kind: "issue_added",
      id: "issue",
      label: "DEAD_CODE App is unused",
      after: report.issues[0],
    },
  ],
  breakingChanges: [],
};

describe("CI output formatters", () => {
  test("formats a PR-ready Markdown report", () => {
    const markdown = formatCiMarkdown({
      report,
      diff,
      baselinePath: "baseline.json",
      gate: {
        passed: false,
        violations: [{ kind: "MIN_HEALTH", message: "too low", current: 99, threshold: 100 }],
      },
    });

    expect(markdown).toContain("# Code MRI CI Report");
    expect(markdown).toContain("Gate: **FAIL**");
    expect(markdown).toContain("## Changed Nodes");
    expect(markdown).toContain("DEAD_CODE: App is unused");
  });

  test("formats SARIF for current issues and gate violations", () => {
    const sarif = JSON.parse(
      formatSarif({
        report,
        gate: {
          passed: false,
          violations: [{ kind: "MIN_HEALTH", message: "too low" }],
        },
      }),
    ) as {
      version: string;
      runs: Array<{ results: Array<{ ruleId: string; locations: unknown[] }> }>;
    };

    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0]?.results.map((item) => item.ruleId)).toEqual([
      "DEAD_CODE",
      "CI_MIN_HEALTH",
    ]);
    expect(sarif.runs[0]?.results[0]?.locations).toHaveLength(1);
  });
});
