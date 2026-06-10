import type { EdgeKind, NodeKind } from "@code-mri/shared-types";

/** Separator between a node's location and a member within it. */
const MEMBER_SEP = "#";

/**
 * Build a stable, deterministic node id.
 *
 * Format: `<Kind>:<part0>#<part1>#...`. The first part is conventionally a
 * repo-relative path; further parts identify members (class, field, etc.).
 */
export function nodeId(kind: NodeKind, ...parts: string[]): string {
  return `${kind}:${parts.join(MEMBER_SEP)}`;
}

/**
 * Build a deterministic edge id so that identical edges (same kind + endpoints)
 * collapse to one entry.
 */
export function edgeId(kind: EdgeKind, from: string, to: string): string {
  return `${kind}:${from}->${to}`;
}
