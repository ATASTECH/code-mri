import type { IssueKind, Issue, ScoreBreakdown, Scores } from "../types.js";

/**
 * Per-issue health penalties. Kept explicit and modest so the final score is
 * fully explainable — the breakdown shows exactly how many points each issue
 * kind removed. No hidden heuristics.
 */
export const HEALTH_WEIGHTS: Record<IssueKind, number> = {
  CIRCULAR_DEPENDENCY: 10,
  GOD_MODEL: 5,
  GOD_COMPONENT: 5,
  LARGE_FILE: 2,
  UNUSED_ENDPOINT: 2,
  DEAD_CODE: 1,
  // Informational only: an unmatched call may target an external API, so it
  // must not penalise the score.
  DANGLING_API_CALL: 0,
  SECRET_CANDIDATE: 15,
  UNCOVERED_RISKY_NODE: 4,
  COMPLEXITY_HOTSPOT: 3,
  BOUNDARY_VIOLATION: 8,
  BREAKING_ENDPOINT_REMOVED: 20,
  BREAKING_ROUTE_METHOD_CHANGED: 20,
  BREAKING_FIELD_REMOVED: 15,
};

/** Compute a 0..100 health score plus a per-kind deduction breakdown. */
export function computeHealth(issues: Issue[]): Scores {
  const breakdown: ScoreBreakdown = {};
  for (const issue of issues) {
    const weight =
      issue.kind === "DEAD_CODE" && issue.candidate && issue.meta?.confidence === "low"
        ? 0
        : HEALTH_WEIGHTS[issue.kind];
    if (weight === 0) continue;
    breakdown[issue.kind] = (breakdown[issue.kind] ?? 0) + weight;
  }
  const deducted = Object.values(breakdown).reduce((sum, n) => sum + n, 0);
  return { health: Math.max(0, 100 - deducted), breakdown };
}
