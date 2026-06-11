/** Public engine API (consumed by the CLI and the desktop app). */
export * from "./types.js";
export { analyzeProject } from "./pipeline/analyze.js";
export type { ProjectAnalysis } from "./pipeline/analyze.js";
export { analyzeProjectRepos } from "./pipeline/analyzeRepos.js";
export type {
  MultiRepoProjectAnalysis,
  MultiRepoProjectInput,
  ProjectRepoAnalysis,
  ProjectRepoInput,
} from "./pipeline/analyzeRepos.js";
export { Graph, buildGraph } from "./graph/index.js";
export { scanRepo } from "./scanner/scan.js";
export type { ScanResult, ScanFile } from "./scanner/scan.js";
export { runRules } from "./rules/index.js";
export { computeHealth } from "./scores/health.js";
export { nodeId, edgeId } from "./ids.js";
export { createPerfCollector } from "./perf/collector.js";
export type { PerfCollector, PerfSnapshot, PhaseTiming } from "./perf/collector.js";
export { assertPerfBudget } from "./perf/budget.js";
export type { PerfBudget } from "./perf/budget.js";
export { buildInsights, insightFilesFromScan } from "./insights/index.js";
export type {
  BuildInsightsOptions,
  BuildInsightsResult,
  InsightFile,
  InsightRepo,
} from "./insights/index.js";
export { progressEvent } from "./progress.js";
export type { ScanProgressEvent, ScanProgressReporter } from "./progress.js";
export { diffReports } from "./diff/reportDiff.js";
export {
  askGraph,
  checkBreakingChanges,
  createAgentQueryContext,
  findDeadCode,
  getNodeContext,
  graphSearch,
  impactQuery,
  nodeReference,
  planGraphQuestion,
  recommendTests,
} from "./agent/index.js";
export type {
  AgentEdgeReference,
  AgentIssueReference,
  AgentNodeReference,
  AgentTestCommand,
  AgentQueryContext,
  AgentToolResult,
  AskGraphInput,
  CheckBreakingChangesInput,
  FindDeadCodeInput,
  GetNodeContextInput,
  GraphSearchInput,
  ImpactQueryInput,
  RecommendTestsInput,
} from "./agent/index.js";
export { createMcpContext, handleMcpRequest, startMcpServer } from "./mcp/server.js";
export type { McpContext, McpScanDefaults } from "./mcp/server.js";
export { evaluateCiGates, coveragePct, formatCiMarkdown, formatSarif } from "./ci/index.js";
export type { CiGateResult, CiGateViolation, CiGateViolationKind } from "./ci/index.js";
export {
  CONFIG_FILE_NAMES,
  EMPTY_CODE_MRI_CONFIG,
  loadCodeMriConfig,
  parseCodeMriConfig,
} from "./config/codemri.js";
export type {
  BoundaryConfig,
  BoundaryGroupConfig,
  BoundaryRuleConfig,
  CiConfig,
  CiGateConfig,
  CodeMriConfig,
  LoadCodeMriConfigOptions,
  PublicApiConfig,
  PublicApiExportConfig,
  RiskConfig,
} from "./config/codemri.js";
export { formatBoundarySuggestion, suggestBoundaryConfig } from "./config/suggest.js";
export {
  CODE_MRI_PRESET_NAMES,
  createCodeMriPresetConfig,
  formatCodeMriConfig,
} from "./config/presets.js";
export type { CodeMriPresetName } from "./config/presets.js";
export { createMemoryFactsCache, createDiskFactsCache } from "./parsers/ts/cache.js";
export type { FactsCache, PersistentFactsCache } from "./parsers/ts/cache.js";
export { createMemoryPyCache, createDiskPyCache } from "./parsers/py/cache.js";
export type { PyCache, PersistentPyCache } from "./parsers/py/cache.js";
