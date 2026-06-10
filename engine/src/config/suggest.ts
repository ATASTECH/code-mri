import yaml from "js-yaml";
import type { Report } from "@code-mri/shared-types";
import type { BoundaryGroupConfig, CodeMriConfig } from "./codemri.js";

function filePathFromNodeId(id: string): string | null {
  const sep = id.indexOf(":");
  if (sep === -1) return null;
  const rest = id.slice(sep + 1);
  return rest.split("#")[0] ?? null;
}

function groupPrefix(file: string): string | null {
  const parts = file.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  if ((parts[0] === "apps" || parts[0] === "packages" || parts[0] === "services") && parts[1]) {
    return `${parts[0]}/${parts[1]}`;
  }
  return parts[0] ?? null;
}

function groupId(prefix: string): string {
  return prefix.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

export function suggestBoundaryConfig(report: Report): CodeMriConfig {
  const prefixes = new Set<string>();
  for (const node of report.nodes) {
    const file = node.loc?.file ?? (node.kind === "File" ? node.name : filePathFromNodeId(node.id));
    if (!file) continue;
    const prefix = groupPrefix(file);
    if (prefix) prefixes.add(prefix);
  }

  const groups: BoundaryGroupConfig[] = [...prefixes].sort().map((prefix) => ({
    id: groupId(prefix),
    paths: [`${prefix}/**`],
  }));

  return {
    boundaries: { groups, rules: [] },
    publicApi: { exports: [] },
    ci: { gates: {} },
    risk: { ignorePaths: [] },
  };
}

export function formatBoundarySuggestion(report: Report): string {
  const config = suggestBoundaryConfig(report);
  return yaml.dump(
    {
      boundaries: config.boundaries,
      publicApi: config.publicApi,
    },
    { lineWidth: 100 },
  );
}
