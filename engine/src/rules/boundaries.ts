import type { EdgeKind, GraphEdge, GraphNode, Issue } from "../types.js";
import type { BoundaryConfig, BoundaryRuleConfig } from "../config/codemri.js";
import { matchesAnyGlob } from "../config/glob.js";
import type { Graph } from "../graph/graph.js";

const DEFAULT_BOUNDARY_EDGE_KINDS = new Set<EdgeKind>([
  "IMPORTS",
  "USES",
  "CALLS",
  "RENDERS",
  "DEPENDS_ON",
  "REFERENCES",
  "REGISTERED_IN",
  "TYPES",
  "CONSUMES",
  "PROVIDES",
]);

interface NodeBoundaryInfo {
  node: GraphNode;
  file: string | null;
  groups: string[];
}

function nodePath(node: GraphNode): string | null {
  if (node.loc?.file) return node.loc.file;
  if (node.kind === "File") return node.name;
  const sep = node.id.indexOf(":");
  if (sep === -1) return null;
  const rest = node.id.slice(sep + 1);
  return rest.split("#")[0] ?? null;
}

function edgeKindAllowed(edge: GraphEdge, rule?: BoundaryRuleConfig): boolean {
  const kinds = rule?.edgeKinds;
  if (kinds) return kinds.includes(edge.kind);
  return DEFAULT_BOUNDARY_EDGE_KINDS.has(edge.kind);
}

function groupMatches(ruleGroups: string[], nodeGroups: string[]): boolean {
  return ruleGroups.includes("*") || nodeGroups.some((group) => ruleGroups.includes(group));
}

function matchingPairs(fromGroups: string[], toGroups: string[], rule: BoundaryRuleConfig) {
  const from = fromGroups.filter((group) => rule.from.includes("*") || rule.from.includes(group));
  const to = toGroups.filter((group) => rule.to.includes("*") || rule.to.includes(group));
  return { from, to };
}

function boundaryIssue(
  edge: GraphEdge,
  from: NodeBoundaryInfo,
  to: NodeBoundaryInfo,
  meta: {
    fromGroup: string;
    toGroup: string;
    rule: "deny" | "allow";
    ruleIndex?: number;
    message?: string;
    allowedTo?: string[];
  },
): Issue {
  const message =
    meta.message ??
    `Boundary violation: ${from.file ?? from.node.name} ${edge.kind} ${to.file ?? to.node.name}`;

  return {
    kind: "BOUNDARY_VIOLATION",
    severity: "medium",
    message,
    nodes: [edge.from, edge.to],
    meta: {
      edgeId: edge.id,
      edgeKind: edge.kind,
      fromGroup: meta.fromGroup,
      toGroup: meta.toGroup,
      fromFile: from.file,
      toFile: to.file,
      rule: meta.rule,
      ...(typeof meta.ruleIndex === "number" ? { ruleIndex: meta.ruleIndex } : {}),
      ...(meta.allowedTo ? { allowedTo: meta.allowedTo.join(", ") } : {}),
    },
  };
}

export function findBoundaryViolations(graph: Graph, config?: BoundaryConfig): Issue[] {
  if (!config?.groups.length || !config.rules.length) return [];

  const byNode = new Map<string, NodeBoundaryInfo>();
  for (const node of graph.nodes()) {
    const file = nodePath(node);
    const groups = file
      ? config.groups
          .filter((group) => matchesAnyGlob(group.paths, file))
          .map((group) => group.id)
      : [];
    byNode.set(node.id, { node, file, groups });
  }

  const denyRules = config.rules.filter((rule) => !rule.allow);
  const allowRules = config.rules.filter((rule) => rule.allow);
  const issues: Issue[] = [];
  const seen = new Set<string>();

  for (const edge of graph.edges()) {
    const from = byNode.get(edge.from);
    const to = byNode.get(edge.to);
    if (!from?.groups.length || !to?.groups.length) continue;

    let denied = false;
    for (const [index, rule] of denyRules.entries()) {
      if (!edgeKindAllowed(edge, rule)) continue;
      if (!groupMatches(rule.from, from.groups) || !groupMatches(rule.to, to.groups)) continue;
      const pairs = matchingPairs(from.groups, to.groups, rule);
      const key = `${edge.id}:deny:${index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      denied = true;
      issues.push(
        boundaryIssue(edge, from, to, {
          fromGroup: pairs.from[0] ?? from.groups[0] ?? "",
          toGroup: pairs.to[0] ?? to.groups[0] ?? "",
          rule: "deny",
          ruleIndex: index,
          message: rule.message,
        }),
      );
    }
    if (denied) continue;

    const relevantAllowRules = allowRules.filter(
      (rule) => edgeKindAllowed(edge, rule) && groupMatches(rule.from, from.groups),
    );
    if (!relevantAllowRules.length) continue;
    if (from.groups.some((group) => to.groups.includes(group))) continue;
    const allowed = relevantAllowRules.some((rule) => groupMatches(rule.to, to.groups));
    if (allowed) continue;

    const key = `${edge.id}:allow`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(
      boundaryIssue(edge, from, to, {
        fromGroup: from.groups[0] ?? "",
        toGroup: to.groups[0] ?? "",
        rule: "allow",
        allowedTo: [...new Set(relevantAllowRules.flatMap((rule) => rule.to))].sort(),
      }),
    );
  }

  return issues;
}
