import type { Report, ReportDiff } from "@code-mri/shared-types";
import { describe, expect, test } from "vitest";
import { formatCiSummary, formatDiffSummary, formatSummary } from "./format.js";

const report: Report = {
  project: { name: "sample-app", stack: ["django", "next.js"], root: "/x" },
  summary: { files: 12, components: 2, models: 1, endpoints: 6 },
  nodes: [],
  edges: [],
  issues: [
    { kind: "DEAD_CODE", severity: "low", message: "", nodes: ["a"], candidate: true },
    { kind: "DEAD_CODE", severity: "low", message: "", nodes: ["b"], candidate: true },
    { kind: "CIRCULAR_DEPENDENCY", severity: "high", message: "", nodes: ["c"] },
  ],
  scores: { health: 88, breakdown: { DEAD_CODE: 2, CIRCULAR_DEPENDENCY: 10 } },
};

describe("formatSummary", () => {
  test("renders project, stack, counts and health", () => {
    const out = formatSummary(report);
    expect(out).toContain("sample-app");
    expect(out).toContain("django");
    expect(out).toContain("Health: 88/100");
    expect(out).toContain("Models: 1");
  });

  test("lists issue counts by kind with the score breakdown", () => {
    const out = formatSummary(report);
    expect(out).toContain("DEAD_CODE");
    expect(out).toContain("CIRCULAR_DEPENDENCY");
  });
});

describe("formatDiffSummary", () => {
  test("renders score, graph and breaking change deltas", () => {
    const diff: ReportDiff = {
      beforeProject: "old",
      afterProject: "new",
      summary: {
        beforeSchemaVersion: 4,
        afterSchemaVersion: 4,
        healthDelta: -12,
        nodesAdded: 1,
        nodesRemoved: 2,
        nodesChanged: 3,
        edgesAdded: 4,
        edgesRemoved: 5,
        issuesAdded: 6,
        issuesRemoved: 7,
        breakingChanges: 1,
      },
      changes: [],
      breakingChanges: [
        {
          kind: "BREAKING_ENDPOINT_REMOVED",
          severity: "high",
          message: "GET /api/users/ was removed",
          nodes: [],
        },
      ],
    };

    const out = formatDiffSummary(diff);

    expect(out).toContain("old → new");
    expect(out).toContain("Health delta: -12");
    expect(out).toContain("Nodes: +1 -2 ~3");
    expect(out).toContain("Breaking changes: 1");
    expect(out).toContain("BREAKING_ENDPOINT_REMOVED");
  });
});

describe("formatCiSummary", () => {
  test("renders pass/fail and gate violations", () => {
    const out = formatCiSummary({
      report,
      baselinePath: "baseline.json",
      diff: null,
      gate: {
        passed: false,
        violations: [
          { kind: "MIN_HEALTH", message: "Health score 88 is below required 90." },
        ],
      },
    });

    expect(out).toContain("Code MRI CI");
    expect(out).toContain("Gate: FAIL");
    expect(out).toContain("baseline.json");
    expect(out).toContain("MIN_HEALTH");
  });
});
