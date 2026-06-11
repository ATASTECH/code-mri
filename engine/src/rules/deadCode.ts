import type { Confidence, EdgeKind, GraphNode, Issue } from "../types.js";
import type { PublicApiConfig } from "../config/codemri.js";
import type { Graph } from "../graph/graph.js";
import { isDeclaredPublicApi } from "./publicApi.js";

/** Does this node have at least one incoming edge of the given kind? */
function hasIncoming(graph: Graph, id: string, kind: EdgeKind): boolean {
  return graph.inEdges(id).some((e) => e.kind === kind);
}

/**
 * Next.js (and similar) convention modules whose exports the framework invokes
 * directly - never imported by app code, so a lack of RENDERS/USES does not mean
 * dead. Matched by filename (no extension).
 */
const FRAMEWORK_ENTRY_FILES = new Set([
  "page",
  "layout",
  "loading",
  "error",
  "global-error",
  "not-found",
  "template",
  "default",
  "route",
  "middleware",
  "instrumentation",
]);

/** Convention export names the framework calls (data fetching, metadata, ...). */
const FRAMEWORK_EXPORT_NAMES = new Set([
  "generateMetadata",
  "generateStaticParams",
  "generateViewport",
  "metadata",
  "viewport",
  "getServerSideProps",
  "getStaticProps",
  "getStaticPaths",
  "getInitialProps",
  "middleware",
  "register",
]);

/** Filename without directory or extension, e.g. "app/layout.tsx" -> "layout". */
function fileStem(file: string): string {
  const base = file.split("/").pop() ?? file;
  const dot = base.indexOf(".");
  return dot >= 0 ? base.slice(0, dot) : base;
}

/**
 * A framework entry point: a symbol the framework wires up by convention rather
 * than via an import. Flagging these as dead would be a false positive.
 */
function isFrameworkEntry(node: GraphNode): boolean {
  const file = node.loc?.file;
  if (file && FRAMEWORK_ENTRY_FILES.has(fileStem(file))) return true;
  return FRAMEWORK_EXPORT_NAMES.has(node.name);
}

/**
 * Confidence that an unused symbol is truly removable. An unexported symbol
 * with no internal use is safe to delete (high); an exported one might be
 * public API consumed outside the scanned code (low).
 */
function removalConfidence(node: GraphNode): Confidence {
  return node.meta?.exported === true ? "low" : "high";
}

/**
 * Heuristic dead-code detection. Every finding is a *candidate* - static
 * analysis cannot prove something is unused (dynamic imports, runtime routing,
 * other API consumers). Entry points (Pages, Celery tasks) are never flagged.
 */
export function findDeadCode(
  graph: Graph,
  opts: { publicApi?: PublicApiConfig } = {},
): Issue[] {
  const issues: Issue[] = [];

  for (const node of graph.nodes()) {
    if (isDeclaredPublicApi(node, opts.publicApi)) continue;
    // Framework-managed entry points are invoked by convention, not by imports.
    if ((node.kind === "Component" || node.kind === "Hook") && isFrameworkEntry(node)) {
      continue;
    }
    if (node.kind === "Component" && !hasIncoming(graph, node.id, "RENDERS")) {
      issues.push(
        candidate("DEAD_CODE", `Component "${node.name}" is never rendered`, node.id, {
          confidence: removalConfidence(node),
        }),
      );
    } else if (node.kind === "Hook" && !hasIncoming(graph, node.id, "USES")) {
      issues.push(
        candidate("DEAD_CODE", `Hook "${node.name}" is never used`, node.id, {
          confidence: removalConfidence(node),
        }),
      );
    } else if (node.kind === "APIEndpoint" && !hasIncoming(graph, node.id, "CALLS")) {
      issues.push(
        candidate("UNUSED_ENDPOINT", `Endpoint "${node.name}" has no frontend caller`, node.id),
      );
    }
  }

  return issues;
}

function candidate(
  kind: Issue["kind"],
  message: string,
  nodeId: string,
  meta?: Record<string, unknown>,
): Issue {
  const issue: Issue = { kind, severity: "low", message, nodes: [nodeId], candidate: true };
  if (meta) issue.meta = meta;
  return issue;
}
