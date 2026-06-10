import type { Confidence, GraphEdge, Issue } from "@code-mri/shared-types";
import { edgeId } from "../ids.js";
import type { BackendRoute } from "../parsers/py/assemble.js";
import type { ResolvedApiCall } from "../parsers/ts/analyze.js";

export interface LinkResult {
  /** CALLS edges to endpoints plus response-field USES edges when provable. */
  edges: GraphEdge[];
  /** API calls that matched no backend route (kept for diagnostics). */
  unmatched: ResolvedApiCall[];
}

function cleanPath(path: string): string {
  const [withoutQuery] = path.split(/[?#]/, 1);
  if (!withoutQuery) return "/";
  const withLeadingSlash = withoutQuery.startsWith("/")
    ? withoutQuery
    : `/${withoutQuery}`;
  return withLeadingSlash.replace(/\/+/g, "/").replace(/\/?$/, "/");
}

function pathSegments(path: string): string[] {
  return cleanPath(path).split("/").filter(Boolean);
}

function isParamSegment(segment: string): boolean {
  return /^\{[^}]+\}$/.test(segment) || segment === ":p";
}

function segmentsMatch(call: string[], route: string[]): boolean {
  if (call.length !== route.length) return false;

  return call.every(
    (segment, index) =>
      segment === route[index] ||
      isParamSegment(segment) ||
      isParamSegment(route[index] ?? ""),
  );
}

function suffixSegmentsMatch(shorter: string[], longer: string[]): boolean {
  if (shorter.length > longer.length) return false;
  const offset = longer.length - shorter.length;
  return shorter.every((segment, index) => segment === longer[index + offset]);
}

const RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

/** Score how confidently an api call matches a route, or null for no match. */
function scoreMatch(call: ResolvedApiCall, route: BackendRoute): Confidence | null {
  if (call.method !== route.method) return null;
  const callPath = cleanPath(call.fullUrl);
  const routePath = cleanPath(route.path);
  if (callPath === routePath && !call.dynamic) return "high";

  const callSegments = pathSegments(callPath);
  const routeSegments = pathSegments(routePath);
  if (segmentsMatch(callSegments, routeSegments)) return "medium";
  if (
    suffixSegmentsMatch(callSegments, routeSegments) ||
    suffixSegmentsMatch(routeSegments, callSegments)
  ) {
    return "low";
  }
  return null;
}

/**
 * Link frontend API calls to backend routes, emitting confidence-scored CALLS
 * edges (caller -> endpoint). Each call links to its single best-matching route.
 */
export function linkCrossStack(
  apiCalls: ResolvedApiCall[],
  routes: BackendRoute[],
): LinkResult {
  const edges: GraphEdge[] = [];
  const edgeIds = new Set<string>();
  const unmatched: ResolvedApiCall[] = [];

  for (const call of apiCalls) {
    let best: { route: BackendRoute; confidence: Confidence } | null = null;
    for (const route of routes) {
      const confidence = scoreMatch(call, route);
      if (!confidence) continue;
      if (!best || RANK[confidence] > RANK[best.confidence]) {
        best = { route, confidence };
      }
    }

    if (!best) {
      unmatched.push(call);
      continue;
    }
    if (!call.callerId) continue; // matched, but no caller node to attach

    const id = edgeId("CALLS", call.callerId, best.route.endpointId);
    if (!edgeIds.has(id)) {
      edgeIds.add(id);
      edges.push({
        id,
        from: call.callerId,
        to: best.route.endpointId,
        kind: "CALLS",
        confidence: best.confidence,
        meta: { url: call.fullUrl, method: call.method },
      });
    }

    const fieldsByName = new Map(
      (best.route.responseFields ?? []).map((field) => [field.name.toLowerCase(), field]),
    );
    for (const use of call.responseFields ?? []) {
      const field = fieldsByName.get(use.field.toLowerCase());
      if (!field) continue;
      const fieldEdgeId = edgeId("USES", call.callerId, field.id);
      if (edgeIds.has(fieldEdgeId)) continue;
      edgeIds.add(fieldEdgeId);
      edges.push({
        id: fieldEdgeId,
        from: call.callerId,
        to: field.id,
        kind: "USES",
        confidence: use.confidence,
        meta: {
          url: call.fullUrl,
          method: call.method,
          field: field.name,
          source: "response-field",
          line: use.line,
        },
      });
    }
  }

  return { edges, unmatched };
}

/**
 * Build diagnostic issues for frontend calls that matched no backend route.
 * Only relative-url calls (intended for the project's own backend) are flagged;
 * absolute external URLs (e.g. third-party APIs) are ignored to avoid noise.
 * Informational only — these never affect the health score.
 */
export function danglingApiCallIssues(unmatched: ResolvedApiCall[]): Issue[] {
  const issues: Issue[] = [];
  for (const call of unmatched) {
    if (!call.callerId) continue; // no caller node to attach the diagnostic to
    if (!call.fullUrl.startsWith("/")) continue; // external/absolute → not our backend
    issues.push({
      kind: "DANGLING_API_CALL",
      severity: "info",
      message: `Call "${call.method} ${call.fullUrl}" matches no known backend route`,
      nodes: [call.callerId],
      candidate: true,
      meta: { url: call.fullUrl, method: call.method },
    });
  }
  return issues;
}
