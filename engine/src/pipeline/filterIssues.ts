import type { GraphNode, Issue } from "@code-mri/shared-types";
import type { CodeMriConfig } from "../config/codemri.js";
import { matchesAnyGlob } from "../config/glob.js";

function nodeFile(node: GraphNode | undefined): string | null {
  if (!node) return null;
  if (node.loc?.file) return node.loc.file;
  return node.kind === "File" ? node.name : null;
}

function issueFiles(issue: Issue, nodes: Map<string, GraphNode>): string[] {
  const files = new Set<string>();
  for (const id of issue.nodes) {
    const file = nodeFile(nodes.get(id));
    if (file) files.add(file);
    else if (id.startsWith("File:")) files.add(id.slice("File:".length));
  }

  const metaFile = issue.meta?.file;
  if (typeof metaFile === "string") files.add(metaFile);
  const metaFiles = issue.meta?.files;
  if (Array.isArray(metaFiles)) {
    for (const file of metaFiles) {
      if (typeof file === "string") files.add(file);
    }
  }
  return [...files];
}

export function filterIgnoredRiskIssues(
  issues: Issue[],
  nodes: GraphNode[],
  config: CodeMriConfig,
): Issue[] {
  const patterns = config.risk.ignorePaths;
  if (patterns.length === 0) return issues;

  const byId = new Map(nodes.map((node) => [node.id, node]));
  return issues.filter((issue) => {
    const files = issueFiles(issue, byId);
    return files.length === 0 || !files.every((file) => matchesAnyGlob(patterns, file));
  });
}
