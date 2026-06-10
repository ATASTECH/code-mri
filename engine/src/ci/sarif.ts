import type { BreakingChange, GraphNode, Issue, Report } from "@code-mri/shared-types";
import type { CiGateResult } from "./gates.js";

interface SarifResultInput {
  ruleId: string;
  level: "error" | "warning" | "note";
  message: string;
  node?: GraphNode;
}

function levelForIssue(issue: Issue): "error" | "warning" | "note" {
  if (issue.severity === "high") return "error";
  if (issue.severity === "medium" || issue.severity === "low") return "warning";
  return "note";
}

function nodeForIssue(issue: Issue, nodes: Map<string, GraphNode>): GraphNode | undefined {
  for (const id of issue.nodes) {
    const node = nodes.get(id);
    if (node?.loc?.file) return node;
  }
  return undefined;
}

function result(input: SarifResultInput) {
  const region = input.node?.loc?.line
    ? {
        startLine: input.node.loc.line,
        ...(input.node.loc.column ? { startColumn: input.node.loc.column } : {}),
      }
    : { startLine: 1 };

  return {
    ruleId: input.ruleId,
    level: input.level,
    message: { text: input.message },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: input.node?.loc?.file ?? "code-mri" },
          region,
        },
      },
    ],
  };
}

function breakingResult(change: BreakingChange, nodes: Map<string, GraphNode>) {
  const node = change.nodes.map((id) => nodes.get(id)).find((item) => item?.loc?.file);
  return result({
    ruleId: change.kind,
    level: change.severity === "high" ? "error" : "warning",
    message: change.message,
    node,
  });
}

export function formatSarif(input: {
  report: Report;
  gate?: CiGateResult;
  breakingChanges?: BreakingChange[];
}): string {
  const nodes = new Map(input.report.nodes.map((node) => [node.id, node]));
  const issueResults = input.report.issues.map((issue) =>
    result({
      ruleId: issue.kind,
      level: levelForIssue(issue),
      message: issue.message,
      node: nodeForIssue(issue, nodes),
    }),
  );
  const breakingResults = (input.breakingChanges ?? []).map((change) =>
    breakingResult(change, nodes),
  );
  const gateResults =
    input.gate?.violations.map((violation) =>
      result({
        ruleId: `CI_${violation.kind}`,
        level: "error",
        message: violation.message,
      }),
    ) ?? [];

  const ruleIds = new Set<string>([
    ...input.report.issues.map((issue) => issue.kind),
    ...(input.breakingChanges ?? []).map((change) => change.kind),
    ...(input.gate?.violations.map((violation) => `CI_${violation.kind}`) ?? []),
  ]);

  return JSON.stringify(
    {
      version: "2.1.0",
      $schema: "https://json.schemastore.org/sarif-2.1.0.json",
      runs: [
        {
          tool: {
            driver: {
              name: "Code MRI",
              informationUri: "https://github.com/code-mri/code-mri",
              rules: [...ruleIds].sort().map((id) => ({
                id,
                name: id,
                shortDescription: { text: id },
              })),
            },
          },
          results: [...issueResults, ...breakingResults, ...gateResults],
        },
      ],
    },
    null,
    2,
  );
}
