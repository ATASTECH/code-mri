/**
 * Code MRI — report type contract.
 *
 * This is the single source of truth for the graph and report shapes that flow
 * between the engine pipeline stages, the CLI JSON output, and the desktop UI.
 * Every stage (scanner, parsers, graph, linker, rules, output) speaks these types.
 */

// ---------------------------------------------------------------------------
// Graph primitives
// ---------------------------------------------------------------------------

export type NodeKind =
  | "File"
  | "Directory"
  | "Function"
  | "Class"
  | "Type"
  | "Context"
  | "Component"
  | "Hook"
  | "Page"
  | "Service"
  | "Model"
  | "Field"
  | "Serializer"
  | "View"
  | "ViewSet"
  | "Route"
  | "APIEndpoint"
  | "DatabaseTable"
  | "DockerService"
  | "EnvVariable"
  | "CeleryTask"
  | "Manager"
  | "Signal";

export type EdgeKind =
  | "IMPORTS"
  | "EXPORTS"
  | "USES"
  | "CALLS"
  | "RENDERS"
  | "EXPOSES"
  | "DEPENDS_ON"
  | "REFERENCES"
  | "REGISTERED_IN"
  | "TYPES"
  | "PROVIDES"
  | "CONSUMES";

/** How sure we are about a cross-stack (CALLS / EXPOSES) link. */
export type Confidence = "high" | "medium" | "low";

export type ProjectRepoRole =
  | "frontend"
  | "backend"
  | "fullstack"
  | "worker"
  | "other";

/** Repo-relative source location. */
export interface SourceLocation {
  /** Path relative to the scanned repo root, POSIX separators. */
  file: string;
  line?: number;
  column?: number;
}

export interface GraphNode {
  /** Stable, deterministic id. See `nodeId()` in the engine. */
  id: string;
  kind: NodeKind;
  name: string;
  loc?: SourceLocation;
  /** Free-form, kind-specific extra data (e.g. http method for an endpoint). */
  meta?: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  /** Source node id. */
  from: string;
  /** Target node id. */
  to: string;
  kind: EdgeKind;
  /** Present for inferred cross-stack links (CALLS / EXPOSES). */
  confidence?: Confidence;
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Issues (rule engine output)
// ---------------------------------------------------------------------------

export type IssueKind =
  | "DEAD_CODE"
  | "CIRCULAR_DEPENDENCY"
  | "LARGE_FILE"
  | "GOD_COMPONENT"
  | "GOD_MODEL"
  | "UNUSED_ENDPOINT"
  | "DANGLING_API_CALL"
  | "SECRET_CANDIDATE"
  | "UNCOVERED_RISKY_NODE"
  | "COMPLEXITY_HOTSPOT"
  | "BOUNDARY_VIOLATION"
  | "BREAKING_ENDPOINT_REMOVED"
  | "BREAKING_ROUTE_METHOD_CHANGED"
  | "BREAKING_FIELD_REMOVED";

export type Severity = "info" | "low" | "medium" | "high";

export interface Issue {
  kind: IssueKind;
  severity: Severity;
  message: string;
  /** Node ids involved in this issue. */
  nodes: string[];
  /**
   * Dead-code style findings are heuristic; `candidate: true` signals the
   * result should be presented as "likely unused", not a certainty.
   */
  candidate?: boolean;
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Report (CLI JSON output / desktop input)
// ---------------------------------------------------------------------------

/** Points deducted per metric, so the health score is fully explainable. */
export type ScoreBreakdown = Record<string, number>;

export interface ProjectInfo {
  name: string;
  /** Detected stack tags, e.g. ["next.js", "django", "docker"]. */
  stack: string[];
  /** Absolute root that was scanned. Kept for single-repo/back-compat reports. */
  root: string;
  /** Local repositories that make up this logical project. */
  repos?: ProjectRepoInfo[];
}

export interface ProjectRepoInfo {
  id: string;
  name: string;
  root: string;
  role: ProjectRepoRole;
  stack: string[];
}

export interface ReportSummary {
  files: number;
  components: number;
  models: number;
  endpoints: number;
}

export interface Scores {
  /** 0..100, derived deterministically from `breakdown`. */
  health: number;
  breakdown: ScoreBreakdown;
}

export interface GitChurnMetric {
  file: string;
  commits: number;
  authors: number;
  lastCommitAt?: string;
}

export interface CoverageMetric {
  file: string;
  total: number;
  covered: number;
  pct: number | null;
  source: "lcov" | "coverage-json";
}

export interface HotspotMetric {
  nodeId: string;
  kind: NodeKind;
  name: string;
  file?: string;
  churn: number;
  authors: number;
  complexity: number;
  fanIn: number;
  fanOut: number;
  impact: number;
  score: number;
  coveragePct?: number | null;
}

export interface SecretFinding {
  file: string;
  line: number;
  column: number;
  rule: string;
  preview: string;
  entropy?: number;
}

export interface ExplanationEvidence {
  nodeId?: string;
  issueKind?: IssueKind;
  file?: string;
  label: string;
}

export interface AiExplanation {
  id: string;
  title: string;
  summary: string;
  evidence: ExplanationEvidence[];
}

export interface DependencyAuditSummary {
  status: "not_run";
  reason: string;
}

export interface AnalysisInsights {
  churn: GitChurnMetric[];
  coverage: CoverageMetric[];
  hotspots: HotspotMetric[];
  secrets: SecretFinding[];
  explanations: AiExplanation[];
  dependencyAudit?: DependencyAuditSummary;
}

export interface Report {
  /** Report contract version. Missing means a pre-v4 imported report. */
  schemaVersion?: typeof REPORT_SCHEMA_VERSION;
  project: ProjectInfo;
  summary: ReportSummary;
  nodes: GraphNode[];
  edges: GraphEdge[];
  issues: Issue[];
  scores: Scores;
  insights?: AnalysisInsights;
}

/** Bumped when the Report shape changes in a breaking way. */
export const REPORT_SCHEMA_VERSION = 4 as const;

export type ReportChangeKind =
  | "node_added"
  | "node_removed"
  | "node_changed"
  | "edge_added"
  | "edge_removed"
  | "issue_added"
  | "issue_removed";

export interface ReportChange {
  kind: ReportChangeKind;
  id: string;
  label: string;
  before?: unknown;
  after?: unknown;
}

export interface BreakingChange {
  kind:
    | "BREAKING_ENDPOINT_REMOVED"
    | "BREAKING_ROUTE_METHOD_CHANGED"
    | "BREAKING_FIELD_REMOVED";
  severity: Severity;
  message: string;
  nodes: string[];
  meta?: Record<string, unknown>;
}

export interface ReportDiffSummary {
  beforeSchemaVersion: number | null;
  afterSchemaVersion: number | null;
  healthDelta: number;
  nodesAdded: number;
  nodesRemoved: number;
  nodesChanged: number;
  edgesAdded: number;
  edgesRemoved: number;
  issuesAdded: number;
  issuesRemoved: number;
  breakingChanges: number;
}

export interface ReportDiff {
  beforeProject: string;
  afterProject: string;
  summary: ReportDiffSummary;
  changes: ReportChange[];
  breakingChanges: BreakingChange[];
}
