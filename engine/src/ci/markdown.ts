import type { GraphNode, Issue, Report, ReportChange, ReportDiff } from "@code-mri/shared-types";
import { buildGraph } from "../graph/build.js";
import type { CiGateResult } from "./gates.js";

function line(items: string[]): string {
  return items.length ? items.join("\n") : "- None";
}

function nodeLabel(node: GraphNode | undefined, fallback: string): string {
  if (!node) return fallback;
  const file = node.loc?.file ? ` (${node.loc.file})` : "";
  return `${node.kind} ${node.name}${file}`;
}

function issueLabel(change: ReportChange): string {
  const issue = (change.after ?? change.before) as Partial<Issue> | undefined;
  if (issue?.kind && issue?.message) return `${issue.kind}: ${issue.message}`;
  return change.label;
}

function changedNodeLines(report: Report, diff?: ReportDiff | null): string[] {
  if (!diff) return [];
  const nodes = new Map(report.nodes.map((node) => [node.id, node]));
  return diff.changes
    .filter((change) => change.kind === "node_added" || change.kind === "node_changed" || change.kind === "node_removed")
    .slice(0, 20)
    .map((change) => `- ${change.kind}: ${nodeLabel(nodes.get(change.id), change.label)}`);
}

function blastRadiusLines(report: Report, diff?: ReportDiff | null): string[] {
  if (!diff) return [];
  const graph = buildGraph({ nodes: report.nodes, edges: report.edges });
  const nodes = new Map(report.nodes.map((node) => [node.id, node]));
  return diff.changes
    .filter((change) => change.kind === "node_changed" || change.kind === "node_added")
    .slice(0, 10)
    .map((change) => {
      const impacted = graph.impact(change.id).slice(0, 5);
      const suffix =
        impacted.length > 0
          ? impacted.map((node) => nodeLabel(node, node.id)).join("; ")
          : "No downstream impact found";
      return `- ${nodeLabel(nodes.get(change.id), change.label)} -> ${suffix}`;
    });
}

export function formatCiMarkdown(input: {
  report: Report;
  gate: CiGateResult;
  diff?: ReportDiff | null;
  baselinePath?: string | null;
}): string {
  const { report, gate, diff } = input;
  const addedIssues =
    diff?.changes.filter((change) => change.kind === "issue_added").slice(0, 20).map(issueLabel) ?? [];
  const removedIssues =
    diff?.changes.filter((change) => change.kind === "issue_removed").slice(0, 20).map(issueLabel) ?? [];

  return [
    `# Code MRI CI Report`,
    "",
    `Project: **${report.project.name}**`,
    `Gate: **${gate.passed ? "PASS" : "FAIL"}**`,
    `Health: **${report.scores.health}/100**`,
    input.baselinePath ? `Baseline: \`${input.baselinePath}\`` : "Baseline: not provided",
    "",
    "## Gate Violations",
    line(gate.violations.map((violation) => `- ${violation.kind}: ${violation.message}`)),
    "",
    "## Diff Summary",
    diff
      ? [
          `- Health delta: ${diff.summary.healthDelta >= 0 ? "+" : ""}${diff.summary.healthDelta}`,
          `- Nodes: +${diff.summary.nodesAdded} -${diff.summary.nodesRemoved} ~${diff.summary.nodesChanged}`,
          `- Edges: +${diff.summary.edgesAdded} -${diff.summary.edgesRemoved}`,
          `- Issues: +${diff.summary.issuesAdded} -${diff.summary.issuesRemoved}`,
          `- Breaking changes: ${diff.summary.breakingChanges}`,
        ].join("\n")
      : "- No baseline diff available",
    "",
    "## Changed Nodes",
    line(changedNodeLines(report, diff)),
    "",
    "## Blast Radius",
    line(blastRadiusLines(report, diff)),
    "",
    "## New Issues",
    line(addedIssues.map((item) => `- ${item}`)),
    "",
    "## Resolved Issues",
    line(removedIssues.map((item) => `- ${item}`)),
    "",
  ].join("\n");
}
