import type {
  BreakingChange,
  GraphEdge,
  GraphNode,
  Issue,
  Report,
  ReportChange,
  ReportDiff,
} from "@code-mri/shared-types";

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${key}:${stable(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function endpointSignature(node: GraphNode): string | null {
  if (node.kind !== "APIEndpoint") return null;
  const method = typeof node.meta?.method === "string" ? node.meta.method : undefined;
  const path = typeof node.meta?.path === "string" ? node.meta.path : undefined;
  if (method && path) return `${method.toUpperCase()} ${path}`;
  return node.name;
}

function endpointPath(signature: string): string {
  return signature.replace(/^[A-Z]+ /, "");
}

function issueKey(issue: Issue): string {
  return `${issue.kind}:${[...issue.nodes].sort().join("|")}:${issue.message}`;
}

function fieldKey(node: GraphNode): string | null {
  return node.kind === "Field" ? node.id : null;
}

function labelNode(node: GraphNode): string {
  return `${node.kind} ${node.name}`;
}

function labelEdge(edge: GraphEdge): string {
  return `${edge.kind} ${edge.from} -> ${edge.to}`;
}

function addMapChanges<T>(
  changes: ReportChange[],
  before: Map<string, T>,
  after: Map<string, T>,
  kind: {
    added: ReportChange["kind"];
    removed: ReportChange["kind"];
    changed?: ReportChange["kind"];
  },
  label: (value: T) => string,
): void {
  for (const [id, value] of before) {
    const next = after.get(id);
    if (!next) {
      changes.push({ kind: kind.removed, id, label: label(value), before: value });
    } else if (kind.changed && stable(value) !== stable(next)) {
      changes.push({ kind: kind.changed, id, label: label(next), before: value, after: next });
    }
  }
  for (const [id, value] of after) {
    if (!before.has(id)) {
      changes.push({ kind: kind.added, id, label: label(value), after: value });
    }
  }
}

function danglingCallKeys(report: Report): Set<string> {
  const out = new Set<string>();
  for (const issue of report.issues) {
    if (issue.kind !== "DANGLING_API_CALL") continue;
    const method = typeof issue.meta?.method === "string" ? issue.meta.method.toUpperCase() : "GET";
    const raw = typeof issue.meta?.url === "string" ? issue.meta.url : undefined;
    if (!raw) continue;
    try {
      const parsed = raw.startsWith("http") ? new URL(raw).pathname : raw;
      out.add(`${method} ${parsed}`);
    } catch {
      out.add(`${method} ${raw}`);
    }
  }
  return out;
}

function serializerFieldUses(report: Report): Set<string> {
  const nodes = new Map(report.nodes.map((node) => [node.id, node]));
  const out = new Set<string>();
  for (const edge of report.edges) {
    if (edge.kind !== "USES") continue;
    if (nodes.get(edge.from)?.kind === "Serializer" && nodes.get(edge.to)?.kind === "Field") {
      out.add(edge.to);
    }
  }
  return out;
}

function breakingChanges(before: Report, after: Report): BreakingChange[] {
  const beforeEndpoints = new Map<string, GraphNode>();
  const afterEndpoints = new Map<string, GraphNode>();
  for (const node of before.nodes) {
    const signature = endpointSignature(node);
    if (signature) beforeEndpoints.set(signature, node);
  }
  for (const node of after.nodes) {
    const signature = endpointSignature(node);
    if (signature) afterEndpoints.set(signature, node);
  }

  const out: BreakingChange[] = [];
  const dangling = danglingCallKeys(after);
  for (const [signature, node] of beforeEndpoints) {
    if (afterEndpoints.has(signature) || !dangling.has(signature)) continue;
    out.push({
      kind: "BREAKING_ENDPOINT_REMOVED",
      severity: "high",
      message: `${signature} was removed while a frontend call still targets it.`,
      nodes: [node.id],
      meta: { signature },
    });
  }

  const beforeByPath = new Map<string, Set<string>>();
  const afterByPath = new Map<string, Set<string>>();
  for (const signature of beforeEndpoints.keys()) {
    const [method] = signature.split(" ");
    const path = endpointPath(signature);
    beforeByPath.set(path, new Set([...(beforeByPath.get(path) ?? []), method as string]));
  }
  for (const signature of afterEndpoints.keys()) {
    const [method] = signature.split(" ");
    const path = endpointPath(signature);
    afterByPath.set(path, new Set([...(afterByPath.get(path) ?? []), method as string]));
  }
  for (const [path, beforeMethods] of beforeByPath) {
    const afterMethods = afterByPath.get(path);
    if (!afterMethods) continue;
    if (stable([...beforeMethods].sort()) === stable([...afterMethods].sort())) continue;
    out.push({
      kind: "BREAKING_ROUTE_METHOD_CHANGED",
      severity: "high",
      message: `${path} changed methods from ${[...beforeMethods].sort().join(",")} to ${[...afterMethods].sort().join(",")}.`,
      nodes: [],
      meta: {
        path,
        beforeMethods: [...beforeMethods].sort(),
        afterMethods: [...afterMethods].sort(),
      },
    });
  }

  const afterFields = new Set(after.nodes.map(fieldKey).filter((key): key is string => key !== null));
  const exposedBefore = serializerFieldUses(before);
  for (const node of before.nodes) {
    const key = fieldKey(node);
    if (!key || afterFields.has(key) || !exposedBefore.has(key)) continue;
    out.push({
      kind: "BREAKING_FIELD_REMOVED",
      severity: "high",
      message: `${node.name} was removed from a serializer-exposed model field.`,
      nodes: [node.id],
      meta: { field: node.name, file: node.loc?.file },
    });
  }

  return out;
}

export function diffReports(before: Report, after: Report): ReportDiff {
  const changes: ReportChange[] = [];
  const beforeNodes = new Map(before.nodes.map((node) => [node.id, node]));
  const afterNodes = new Map(after.nodes.map((node) => [node.id, node]));
  const beforeEdges = new Map(before.edges.map((edge) => [edge.id, edge]));
  const afterEdges = new Map(after.edges.map((edge) => [edge.id, edge]));
  const beforeIssues = new Map(before.issues.map((issue) => [issueKey(issue), issue]));
  const afterIssues = new Map(after.issues.map((issue) => [issueKey(issue), issue]));

  addMapChanges(
    changes,
    beforeNodes,
    afterNodes,
    { added: "node_added", removed: "node_removed", changed: "node_changed" },
    labelNode,
  );
  addMapChanges(
    changes,
    beforeEdges,
    afterEdges,
    { added: "edge_added", removed: "edge_removed" },
    labelEdge,
  );
  addMapChanges(
    changes,
    beforeIssues,
    afterIssues,
    { added: "issue_added", removed: "issue_removed" },
    (issue) => `${issue.kind} ${issue.message}`,
  );

  const breaking = breakingChanges(before, after);
  const count = (kind: ReportChange["kind"]) => changes.filter((change) => change.kind === kind).length;

  return {
    beforeProject: before.project.name,
    afterProject: after.project.name,
    summary: {
      beforeSchemaVersion: before.schemaVersion ?? null,
      afterSchemaVersion: after.schemaVersion ?? null,
      healthDelta: after.scores.health - before.scores.health,
      nodesAdded: count("node_added"),
      nodesRemoved: count("node_removed"),
      nodesChanged: count("node_changed"),
      edgesAdded: count("edge_added"),
      edgesRemoved: count("edge_removed"),
      issuesAdded: count("issue_added"),
      issuesRemoved: count("issue_removed"),
      breakingChanges: breaking.length,
    },
    changes,
    breakingChanges: breaking,
  };
}
