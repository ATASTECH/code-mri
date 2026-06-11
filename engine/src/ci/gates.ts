import type { Issue, Report, ReportDiff } from "../types.js";
import type { CiGateConfig } from "../config/codemri.js";

export type CiGateViolationKind =
  | "MIN_HEALTH"
  | "MAX_NEW_ISSUES"
  | "BREAKING_CHANGES"
  | "BOUNDARY_VIOLATIONS"
  | "MIN_COVERAGE"
  | "COVERAGE_MISSING";

export interface CiGateViolation {
  kind: CiGateViolationKind;
  message: string;
  current?: number;
  threshold?: number;
}

export interface CiGateResult {
  passed: boolean;
  violations: CiGateViolation[];
}

function currentBreakingIssueCount(report: Report): number {
  return report.issues.filter((issue) => issue.kind.startsWith("BREAKING_")).length;
}

function issueCount(report: Report, kind: Issue["kind"]): number {
  return report.issues.filter((issue) => issue.kind === kind).length;
}

export function coveragePct(report: Report): number | null {
  const coverage = report.insights?.coverage ?? [];
  let total = 0;
  let covered = 0;
  for (const item of coverage) {
    total += item.total;
    covered += item.covered;
  }
  if (total <= 0) return null;
  return (covered / total) * 100;
}

export function evaluateCiGates(
  report: Report,
  opts: { diff?: ReportDiff | null; gates?: CiGateConfig } = {},
): CiGateResult {
  const gates = opts.gates ?? {};
  const violations: CiGateViolation[] = [];

  if (gates.minHealth !== undefined && report.scores.health < gates.minHealth) {
    violations.push({
      kind: "MIN_HEALTH",
      message: `Health score ${report.scores.health} is below required ${gates.minHealth}.`,
      current: report.scores.health,
      threshold: gates.minHealth,
    });
  }

  if (
    gates.maxNewIssues !== undefined &&
    opts.diff &&
    opts.diff.summary.issuesAdded > gates.maxNewIssues
  ) {
    violations.push({
      kind: "MAX_NEW_ISSUES",
      message: `${opts.diff.summary.issuesAdded} new issue(s) exceed allowed ${gates.maxNewIssues}.`,
      current: opts.diff.summary.issuesAdded,
      threshold: gates.maxNewIssues,
    });
  }

  if (gates.forbidBreakingChanges) {
    const breaking = (opts.diff?.summary.breakingChanges ?? 0) + currentBreakingIssueCount(report);
    if (breaking > 0) {
      violations.push({
        kind: "BREAKING_CHANGES",
        message: `${breaking} breaking change(s) detected.`,
        current: breaking,
        threshold: 0,
      });
    }
  }

  if (gates.forbidBoundaryViolations) {
    const boundaryViolations = issueCount(report, "BOUNDARY_VIOLATION");
    if (boundaryViolations > 0) {
      violations.push({
        kind: "BOUNDARY_VIOLATIONS",
        message: `${boundaryViolations} boundary violation(s) detected.`,
        current: boundaryViolations,
        threshold: 0,
      });
    }
  }

  if (gates.minCoveragePct !== undefined) {
    const pct = coveragePct(report);
    if (pct === null) {
      violations.push({
        kind: "COVERAGE_MISSING",
        message: `Coverage data is required for minCoveragePct ${gates.minCoveragePct}.`,
        threshold: gates.minCoveragePct,
      });
    } else if (pct < gates.minCoveragePct) {
      violations.push({
        kind: "MIN_COVERAGE",
        message: `Coverage ${pct.toFixed(1)}% is below required ${gates.minCoveragePct}%.`,
        current: pct,
        threshold: gates.minCoveragePct,
      });
    }
  }

  return { passed: violations.length === 0, violations };
}
