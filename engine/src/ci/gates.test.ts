import type { Report, ReportDiff } from "@code-mri/shared-types";
import { describe, expect, test } from "vitest";
import { coveragePct, evaluateCiGates } from "./gates.js";

function report(overrides: Partial<Report> = {}): Report {
  return {
    schemaVersion: 4,
    project: { name: "demo", root: "/repo", stack: [] },
    summary: { files: 1, components: 0, models: 0, endpoints: 0 },
    nodes: [],
    edges: [],
    issues: [],
    scores: { health: 100, breakdown: {} },
    ...overrides,
  };
}

function diff(overrides: Partial<ReportDiff["summary"]> = {}): ReportDiff {
  return {
    beforeProject: "before",
    afterProject: "after",
    summary: {
      beforeSchemaVersion: 4,
      afterSchemaVersion: 4,
      healthDelta: 0,
      nodesAdded: 0,
      nodesRemoved: 0,
      nodesChanged: 0,
      edgesAdded: 0,
      edgesRemoved: 0,
      issuesAdded: 0,
      issuesRemoved: 0,
      breakingChanges: 0,
      ...overrides,
    },
    changes: [],
    breakingChanges: [],
  };
}

describe("evaluateCiGates", () => {
  test("passes when configured gates are satisfied", () => {
    expect(
      evaluateCiGates(report({ scores: { health: 95, breakdown: {} } }), {
        diff: diff({ issuesAdded: 0 }),
        gates: { minHealth: 90, maxNewIssues: 0 },
      }),
    ).toEqual({ passed: true, violations: [] });
  });

  test("fails configured health, new issue, breaking, boundary, and coverage gates", () => {
    const result = evaluateCiGates(
      report({
        scores: { health: 70, breakdown: { BOUNDARY_VIOLATION: 8 } },
        issues: [
          {
            kind: "BOUNDARY_VIOLATION",
            severity: "medium",
            message: "bad boundary",
            nodes: [],
          },
        ],
        insights: {
          churn: [],
          coverage: [{ file: "a.ts", total: 10, covered: 6, pct: 60, source: "lcov" }],
          hotspots: [],
          secrets: [],
          explanations: [],
        },
      }),
      {
        diff: diff({ issuesAdded: 2, breakingChanges: 1 }),
        gates: {
          minHealth: 80,
          maxNewIssues: 0,
          forbidBreakingChanges: true,
          forbidBoundaryViolations: true,
          minCoveragePct: 90,
        },
      },
    );

    expect(result.passed).toBe(false);
    expect(result.violations.map((violation) => violation.kind)).toEqual([
      "MIN_HEALTH",
      "MAX_NEW_ISSUES",
      "BREAKING_CHANGES",
      "BOUNDARY_VIOLATIONS",
      "MIN_COVERAGE",
    ]);
  });

  test("fails a configured coverage gate when coverage data is missing", () => {
    const result = evaluateCiGates(report(), { gates: { minCoveragePct: 75 } });
    expect(result.violations).toEqual([
      expect.objectContaining({ kind: "COVERAGE_MISSING", threshold: 75 }),
    ]);
  });

  test("computes weighted aggregate coverage", () => {
    expect(
      coveragePct(
        report({
          insights: {
            churn: [],
            coverage: [
              { file: "a.ts", total: 10, covered: 5, pct: 50, source: "lcov" },
              { file: "b.ts", total: 30, covered: 30, pct: 100, source: "lcov" },
            ],
            hotspots: [],
            secrets: [],
            explanations: [],
          },
        }),
      ),
    ).toBe(87.5);
  });
});
