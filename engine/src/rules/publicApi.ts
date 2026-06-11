import type { GraphNode } from "../types.js";
import type { PublicApiConfig } from "../config/codemri.js";
import { matchesAnyGlob } from "../config/glob.js";

function nodePath(node: GraphNode): string | null {
  if (node.loc?.file) return node.loc.file;
  if (node.kind === "File") return node.name;
  const sep = node.id.indexOf(":");
  if (sep === -1) return null;
  const rest = node.id.slice(sep + 1);
  return rest.split("#")[0] ?? null;
}

export function isDeclaredPublicApi(node: GraphNode, config?: PublicApiConfig): boolean {
  if (!config?.exports.length) return false;
  const file = nodePath(node);

  return config.exports.some((entry) => {
    if (entry.ids?.includes(node.id)) return true;
    if (entry.kinds && !entry.kinds.includes(node.kind)) return false;
    if (entry.names && !entry.names.includes(node.name)) return false;
    if (entry.paths) return file ? matchesAnyGlob(entry.paths, file) : false;
    return false;
  });
}
