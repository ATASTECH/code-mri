import type { IssueKind, Report, ReportDiff } from "../types.js";
import type { CiGateResult } from "../ci/gates.js";

/** Render a human-readable scan summary for the terminal. */
export function formatSummary(report: Report): string {
  const { project, summary, issues, scores } = report;
  const lines: string[] = [];

  lines.push(`Code MRI — ${project.name}`);
  lines.push(`Stack: ${project.stack.join(", ") || "(unknown)"}`);
  lines.push(
    `Files: ${summary.files}  Components: ${summary.components}  ` +
      `Models: ${summary.models}  Endpoints: ${summary.endpoints}`,
  );
  lines.push("");
  lines.push(`Health: ${scores.health}/100`);
  for (const [kind, points] of Object.entries(scores.breakdown)) {
    lines.push(`  -${points}  ${kind}`);
  }

  const counts = new Map<IssueKind, number>();
  for (const issue of issues) counts.set(issue.kind, (counts.get(issue.kind) ?? 0) + 1);
  lines.push("");
  lines.push(`Issues: ${issues.length}`);
  for (const [kind, count] of counts) lines.push(`  ${count}  ${kind}`);

  return lines.join("\n");
}

export function formatDiffSummary(diff: ReportDiff): string {
  const { summary } = diff;
  const lines: string[] = [];

  lines.push(`Code MRI diff — ${diff.beforeProject} → ${diff.afterProject}`);
  lines.push(`Health delta: ${summary.healthDelta >= 0 ? "+" : ""}${summary.healthDelta}`);
  lines.push(
    `Nodes: +${summary.nodesAdded} -${summary.nodesRemoved} ~${summary.nodesChanged}`,
  );
  lines.push(`Edges: +${summary.edgesAdded} -${summary.edgesRemoved}`);
  lines.push(`Issues: +${summary.issuesAdded} -${summary.issuesRemoved}`);
  lines.push(`Breaking changes: ${summary.breakingChanges}`);
  for (const item of diff.breakingChanges) {
    lines.push(`  ${item.severity.toUpperCase()} ${item.kind}: ${item.message}`);
  }

  return lines.join("\n");
}

export function formatCiSummary(input: {
  report: Report;
  gate: CiGateResult;
  diff?: ReportDiff | null;
  baselinePath?: string | null;
}): string {
  const { report, gate, diff } = input;
  const lines: string[] = [];

  lines.push(`Code MRI CI — ${report.project.name}`);
  lines.push(`Gate: ${gate.passed ? "PASS" : "FAIL"}`);
  lines.push(`Health: ${report.scores.health}/100`);
  lines.push(`Baseline: ${input.baselinePath ?? "(none)"}`);
  if (diff) {
    lines.push(
      `Diff: health ${diff.summary.healthDelta >= 0 ? "+" : ""}${diff.summary.healthDelta}, ` +
        `issues +${diff.summary.issuesAdded}/-${diff.summary.issuesRemoved}, ` +
        `breaking ${diff.summary.breakingChanges}`,
    );
  } else {
    lines.push("Diff: no baseline");
  }

  if (!gate.passed) {
    lines.push("");
    lines.push("Gate violations:");
    for (const violation of gate.violations) {
      lines.push(`  ${violation.kind}: ${violation.message}`);
    }
  }

  return lines.join("\n");
}
