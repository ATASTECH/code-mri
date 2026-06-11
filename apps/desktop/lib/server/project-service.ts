import "server-only"

import * as path from "node:path"
import { analyzeProjectReposViaCli } from "@/lib/server/engine-runner"
import { diffReports } from "@code-mri/engine/diff"
import type {
  GraphEdge,
  GraphNode,
  Issue,
  ProjectRepoInfo,
  ProjectRepoRole,
  Report,
  ReportChange,
  ReportDiff,
} from "@code-mri/engine"
import {
  createProject,
  getActiveProjectId,
  getProject,
  listProjectMetricSnapshots,
  listProjectReportSnapshots,
  listProjects,
  previousSuccessfulReportSnapshot,
  recordFailedScan,
  recordSuccessfulScan,
  resolveProjectDataDir,
  setActiveProject,
  updateProject,
  updateProjectSettings,
  type RepoGitSnapshot,
  type StoredMetricSnapshot,
  type StoredProject,
  type StoredProjectRepo,
} from "@/lib/server/project-db"
import { readGitState } from "@/lib/server/git-state"

const ROLES = new Set<ProjectRepoRole>([
  "frontend",
  "backend",
  "fullstack",
  "worker",
  "other",
])
const HEALTH_REGRESSION_THRESHOLD = 5

export interface ProjectRepoDraft {
  id?: string
  name?: string
  root: string
  role?: ProjectRepoRole
}

export interface CreateProjectRequest {
  name: string
  repos: ProjectRepoDraft[]
}

export interface ProjectRepoSummary {
  id: string
  name: string
  root: string
  role: ProjectRepoRole
  stack: string[]
  gitHead: string | null
  gitDirty: boolean
}

export interface ProjectStaleRepo {
  id: string
  name: string
  root: string
  role: ProjectRepoRole
  previousGitHead: string | null
  currentGitHead: string | null
  previousGitDirty: boolean
  currentGitDirty: boolean
  reasons: Array<"head" | "dirty">
}

export interface ProjectSummary {
  id: string
  name: string
  repoCount: number
  repos: ProjectRepoSummary[]
  autoScanOnChange: boolean
  status: "idle" | "success" | "error"
  error: string | null
  lastScannedAt: string | null
  latestScanId: string | null
  needsRefresh: boolean
  staleRepos: ProjectStaleRepo[]
}

export interface ActiveReportDiffPayload {
  beforeScanId: string
  afterScanId: string
  beforeFinishedAt: string | null
  afterFinishedAt: string | null
  diff: ReportDiff
}

export interface ProjectTrendPayload {
  snapshots: StoredMetricSnapshot[]
  latest: StoredMetricSnapshot | null
  previous: StoredMetricSnapshot | null
  healthDelta: number | null
  issueDelta: number | null
  repoActivity: RepoContributionSeries[]
  erosion: ErosionPoint[]
  nodeHistory: NodeHistorySeries[]
}

export interface ErosionPoint {
  scanId: string
  date: string | null
  circularCount: number
  crossBoundaryEdges: number
}

export interface NodeHistoryPoint {
  scanId: string
  date: string | null
  churn: number | null
  complexity: number | null
  coveragePct: number | null
}

export interface NodeHistorySeries {
  nodeId: string
  name: string
  file: string | null
  points: NodeHistoryPoint[]
}

export interface RepoContributionCell {
  scanId: string
  date: string | null
  count: number
  intensity: 0 | 1 | 2 | 3 | 4
}

export interface RepoContributionSeries {
  repoId: string
  repoName: string
  role: ProjectRepoRole
  totalChanges: number
  cells: RepoContributionCell[]
}

export interface RegressionAlertPayload {
  kind: "HEALTH_DROP" | "NEW_CIRCULAR_DEPENDENCY" | "NEW_BREAKING_CHANGE"
  severity: "medium" | "high"
  message: string
  current: number
  previous: number | null
  delta: number | null
}

export interface ProjectsPayload {
  projects: ProjectSummary[]
  activeProjectId: string | null
  activeReport: Report | null
  activeReportDiff: ActiveReportDiffPayload | null
  activeTrend: ProjectTrendPayload | null
  activeRegressionAlerts: RegressionAlertPayload[]
}

export interface UpdateProjectSettingsRequest {
  autoScanOnChange: boolean
}

export type UpdateProjectRequest = CreateProjectRequest

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function slugify(value: string, fallback: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return slug || fallback
}

function titleFromSlug(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ")
}

function inferRole(stack: string[]): ProjectRepoRole {
  if (stack.includes("next.js") || stack.includes("react")) return "frontend"
  if (stack.includes("django")) return "backend"
  return "other"
}

function normalizeRepos(repos: ProjectRepoDraft[]): Array<{
  id: string
  name: string
  root: string
  role: ProjectRepoRole
}> {
  const seen = new Map<string, number>()

  return repos
    .filter((repo) => repo.root.trim().length > 0)
    .map((repo, index) => {
      const root = repo.root.trim()
      const explicitId = repo.id?.trim()
      const base = explicitId || repo.name || path.basename(root) || `repo-${index + 1}`
      const firstSlug = slugify(base, `repo-${index + 1}`)
      const count = seen.get(firstSlug) ?? 0
      seen.set(firstSlug, count + 1)
      const id = count > 0 ? `${firstSlug}-${count + 1}` : firstSlug
      const role = repo.role && ROLES.has(repo.role) ? repo.role : "other"

      return {
        id,
        name: repo.name?.trim() || titleFromSlug(id),
        root: path.resolve(root),
        role,
      }
    })
}

function validateProjectRequest(input: CreateProjectRequest): ReturnType<typeof normalizeRepos> {
  if (!input.name.trim()) {
    throw new Error("Project name is required")
  }

  const repos = normalizeRepos(input.repos)
  if (repos.length === 0) {
    throw new Error("At least one repository path is required")
  }

  return repos
}

async function snapshotsForRepos(repos: StoredProjectRepo[]): Promise<RepoGitSnapshot[]> {
  return Promise.all(
    repos.map(async (repo) => {
      const state = await readGitState(repo.root)
      return {
        repoId: repo.id,
        gitHead: state.gitHead,
        gitDirty: state.gitDirty,
      }
    }),
  )
}

function repoSummary(repo: StoredProjectRepo): ProjectRepoSummary {
  return {
    id: repo.id,
    name: repo.name,
    root: repo.root,
    role: repo.role,
    stack: repo.stack,
    gitHead: repo.gitHead,
    gitDirty: repo.gitDirty,
  }
}

function staleReposForProject(
  project: StoredProject,
  snapshots: RepoGitSnapshot[],
): ProjectStaleRepo[] {
  if (!project.latestScanId) return []

  const snapshotByRepo = new Map(snapshots.map((snapshot) => [snapshot.repoId, snapshot]))
  const staleRepos: ProjectStaleRepo[] = []

  for (const repo of project.repos) {
    const snapshot = snapshotByRepo.get(repo.id)
    if (!snapshot) continue

    const reasons: ProjectStaleRepo["reasons"] = []
    if (repo.gitHead !== snapshot.gitHead) reasons.push("head")
    if (repo.gitDirty !== snapshot.gitDirty) reasons.push("dirty")
    if (reasons.length === 0) continue

    staleRepos.push({
      id: repo.id,
      name: repo.name,
      root: repo.root,
      role: repo.role,
      previousGitHead: repo.gitHead,
      currentGitHead: snapshot.gitHead,
      previousGitDirty: repo.gitDirty,
      currentGitDirty: snapshot.gitDirty,
      reasons,
    })
  }

  return staleRepos
}

function projectSummary(
  project: StoredProject,
  snapshots: RepoGitSnapshot[],
): ProjectSummary {
  const staleRepos = staleReposForProject(project, snapshots)

  return {
    id: project.id,
    name: project.name,
    repoCount: project.repos.length,
    repos: project.repos.map(repoSummary),
    autoScanOnChange: project.autoScanOnChange,
    status: project.status,
    error: project.error,
    lastScannedAt: project.lastScannedAt,
    latestScanId: project.latestScanId,
    needsRefresh: staleRepos.length > 0,
    staleRepos,
  }
}

function activeReportDiffForProject(
  project: StoredProject | null,
): ActiveReportDiffPayload | null {
  if (!project?.latestReport || !project.latestScanId) return null

  const previous = previousSuccessfulReportSnapshot(project.id, project.latestScanId)
  if (!previous) return null

  return {
    beforeScanId: previous.scanId,
    afterScanId: project.latestScanId,
    beforeFinishedAt: previous.finishedAt,
    afterFinishedAt: project.lastScannedAt,
    diff: diffReports(previous.report, project.latestReport),
  }
}

function activeTrendForProject(project: StoredProject | null): ProjectTrendPayload | null {
  if (!project) return null

  const snapshots = listProjectMetricSnapshots(project.id, 12)
  const latest = snapshots.at(-1) ?? null
  const previous = snapshots.at(-2) ?? null
  const reports = listProjectReportSnapshots(project.id, 12)

  return {
    snapshots,
    latest,
    previous,
    healthDelta: latest && previous ? latest.health - previous.health : null,
    issueDelta: latest && previous ? latest.issueCount - previous.issueCount : null,
    repoActivity: repoActivityForProject(project, reports),
    erosion: erosionForSnapshots(project, reports),
    nodeHistory: nodeHistoryForSnapshots(reports),
  }
}

const NODE_HISTORY_LIMIT = 12

function erosionForSnapshots(
  project: StoredProject,
  snapshots: Array<{ scanId: string; finishedAt: string | null; report: Report }>,
): ErosionPoint[] {
  return snapshots.map((snapshot) => {
    const nodeRepo = buildNodeRepoMap(snapshot.report, project.repos)
    let crossBoundaryEdges = 0
    for (const edge of snapshot.report.edges) {
      const from = nodeRepo.get(edge.from)
      const to = nodeRepo.get(edge.to)
      if (from && to && from !== to) crossBoundaryEdges += 1
    }

    return {
      scanId: snapshot.scanId,
      date: snapshot.finishedAt,
      circularCount: snapshot.report.issues.filter(
        (issue) => issue.kind === "CIRCULAR_DEPENDENCY",
      ).length,
      crossBoundaryEdges,
    }
  })
}

function nodeHistoryForSnapshots(
  snapshots: Array<{ scanId: string; finishedAt: string | null; report: Report }>,
): NodeHistorySeries[] {
  const latest = snapshots.at(-1)
  const hotspots = latest?.report.insights?.hotspots.slice(0, NODE_HISTORY_LIMIT) ?? []

  return hotspots.map((hotspot) => ({
    nodeId: hotspot.nodeId,
    name: hotspot.name,
    file: hotspot.file ?? null,
    points: snapshots.map((snapshot) => {
      const match = snapshot.report.insights?.hotspots.find(
        (candidate) =>
          (hotspot.file && candidate.file === hotspot.file) ||
          candidate.nodeId === hotspot.nodeId,
      )

      return {
        scanId: snapshot.scanId,
        date: snapshot.finishedAt,
        churn: match?.churn ?? null,
        complexity: match?.complexity ?? null,
        coveragePct: match?.coveragePct ?? null,
      }
    }),
  }))
}

function isGraphNode(value: unknown): value is GraphNode {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as GraphNode).id === "string" &&
      typeof (value as GraphNode).kind === "string",
  )
}

function isGraphEdge(value: unknown): value is GraphEdge {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as GraphEdge).from === "string" &&
      typeof (value as GraphEdge).to === "string",
  )
}

function isIssue(value: unknown): value is Issue {
  return Boolean(
    value &&
      typeof value === "object" &&
      Array.isArray((value as Issue).nodes),
  )
}

function fileRepoId(file: string | undefined, repos: StoredProjectRepo[]): string | null {
  if (!file) return null
  const normalized = file.replace(/\\/g, "/")
  const direct = repos.find((repo) => normalized.startsWith(`${repo.id}/`))
  if (direct) return direct.id

  const roleMatch = repos.find(
    (repo) => repo.role !== "other" && normalized.startsWith(`${repo.role}/`),
  )
  if (roleMatch) return roleMatch.id

  return repos.length === 1 ? repos[0]?.id ?? null : null
}

function buildNodeRepoMap(report: Report, repos: StoredProjectRepo[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const node of report.nodes) {
    const repoId = fileRepoId(node.loc?.file, repos)
    if (repoId) out.set(node.id, repoId)
  }
  return out
}

function repoIdsFromChange(
  change: ReportChange,
  repos: StoredProjectRepo[],
  nodeRepo: Map<string, string>,
): Set<string> {
  const out = new Set<string>()
  const visit = (value: unknown) => {
    if (isGraphNode(value)) {
      const byLoc = fileRepoId(value.loc?.file, repos)
      const byId = nodeRepo.get(value.id)
      if (byLoc) out.add(byLoc)
      if (byId) out.add(byId)
      return
    }

    if (isGraphEdge(value)) {
      const from = nodeRepo.get(value.from)
      const to = nodeRepo.get(value.to)
      if (from) out.add(from)
      if (to) out.add(to)
      return
    }

    if (isIssue(value)) {
      for (const node of value.nodes) {
        const repoId = nodeRepo.get(node)
        if (repoId) out.add(repoId)
      }
    }
  }

  visit(change.before)
  visit(change.after)

  if (out.size === 0) {
    const repoId = fileRepoId(change.id, repos) ?? fileRepoId(change.label, repos)
    if (repoId) out.add(repoId)
  }

  return out
}

function intensity(count: number, max: number): RepoContributionCell["intensity"] {
  if (count <= 0 || max <= 0) return 0
  const ratio = count / max
  if (ratio <= 0.25) return 1
  if (ratio <= 0.5) return 2
  if (ratio <= 0.75) return 3
  return 4
}

function repoActivityForProject(
  project: StoredProject,
  snapshots: Array<{ scanId: string; finishedAt: string | null; report: Report }>,
): RepoContributionSeries[] {
  const counts = new Map<string, Map<string, number>>()
  for (const repo of project.repos) counts.set(repo.id, new Map())

  for (let index = 0; index < snapshots.length; index += 1) {
    const current = snapshots[index]
    if (!current) continue
    for (const repo of project.repos) {
      counts.get(repo.id)?.set(current.scanId, 0)
    }
    if (index === 0) continue

    const previous = snapshots[index - 1]
    if (!previous) continue
    const diff = diffReports(previous.report, current.report)
    const nodeRepo = new Map([
      ...buildNodeRepoMap(previous.report, project.repos),
      ...buildNodeRepoMap(current.report, project.repos),
    ])

    for (const change of diff.changes) {
      for (const repoId of repoIdsFromChange(change, project.repos, nodeRepo)) {
        const byScan = counts.get(repoId)
        if (byScan) byScan.set(current.scanId, (byScan.get(current.scanId) ?? 0) + 1)
      }
    }
  }

  const max = Math.max(
    0,
    ...[...counts.values()].flatMap((byScan) => [...byScan.values()]),
  )

  return project.repos.map((repo) => {
    const byScan = counts.get(repo.id) ?? new Map<string, number>()
    const cells = snapshots.map((snapshot) => {
      const count = byScan.get(snapshot.scanId) ?? 0
      return {
        scanId: snapshot.scanId,
        date: snapshot.finishedAt,
        count,
        intensity: intensity(count, max),
      }
    })

    return {
      repoId: repo.id,
      repoName: repo.name,
      role: repo.role,
      totalChanges: cells.reduce((sum, cell) => sum + cell.count, 0),
      cells,
    }
  })
}

function regressionAlertsForProject(
  trend: ProjectTrendPayload | null,
  diff: ActiveReportDiffPayload | null,
): RegressionAlertPayload[] {
  const alerts: RegressionAlertPayload[] = []
  const latest = trend?.latest ?? null
  const previous = trend?.previous ?? null

  if (latest && previous) {
    const healthDelta = latest.health - previous.health
    if (healthDelta <= -HEALTH_REGRESSION_THRESHOLD) {
      alerts.push({
        kind: "HEALTH_DROP",
        severity: "high",
        message: `Health score dropped by ${Math.abs(healthDelta)} points.`,
        current: latest.health,
        previous: previous.health,
        delta: healthDelta,
      })
    }

    const circularDelta = latest.circularCount - previous.circularCount
    if (circularDelta > 0) {
      alerts.push({
        kind: "NEW_CIRCULAR_DEPENDENCY",
        severity: "high",
        message: `${circularDelta} new circular dependency issue${circularDelta === 1 ? "" : "s"} detected.`,
        current: latest.circularCount,
        previous: previous.circularCount,
        delta: circularDelta,
      })
    }
  }

  const breakingCount = diff?.diff.breakingChanges.length ?? 0
  if (breakingCount > 0) {
    alerts.push({
      kind: "NEW_BREAKING_CHANGE",
      severity: "high",
      message: `${breakingCount} breaking change${breakingCount === 1 ? "" : "s"} detected since the previous successful scan.`,
      current: breakingCount,
      previous: 0,
      delta: breakingCount,
    })
  }

  return alerts
}

export async function projectsPayload(): Promise<ProjectsPayload> {
  const projects = listProjects()
  let activeProjectId = getActiveProjectId()

  if (!activeProjectId || !projects.some((project) => project.id === activeProjectId)) {
    activeProjectId = projects[0]?.id ?? null
    if (activeProjectId) setActiveProject(activeProjectId)
  }

  const snapshots = await Promise.all(
    projects.map((project) => snapshotsForRepos(project.repos)),
  )
  const summaries = projects.map((project, index) =>
    projectSummary(project, snapshots[index]),
  )
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null
  const activeReportDiff = activeReportDiffForProject(activeProject)
  const activeTrend = activeTrendForProject(activeProject)

  return {
    projects: summaries,
    activeProjectId,
    activeReport: activeProject?.latestReport ?? null,
    activeReportDiff,
    activeTrend,
    activeRegressionAlerts: regressionAlertsForProject(activeTrend, activeReportDiff),
  }
}

export async function selectProjectPayload(projectId: string): Promise<ProjectsPayload> {
  if (!getProject(projectId)) {
    throw new Error("Project not found")
  }

  setActiveProject(projectId)
  return projectsPayload()
}

export async function updateProjectSettingsPayload(
  projectId: string,
  input: UpdateProjectSettingsRequest,
): Promise<ProjectsPayload> {
  if (typeof input.autoScanOnChange !== "boolean") {
    throw new Error("autoScanOnChange must be a boolean")
  }

  updateProjectSettings(projectId, {
    autoScanOnChange: input.autoScanOnChange,
  })

  return projectsPayload()
}

export async function updateProjectPayload(
  projectId: string,
  input: UpdateProjectRequest,
): Promise<ProjectsPayload> {
  if (!getProject(projectId)) {
    throw new Error("Project not found")
  }

  const repos = validateProjectRequest(input)
  updateProject(projectId, {
    name: input.name.trim(),
    repos,
  })
  setActiveProject(projectId)

  return projectsPayload()
}

export async function scanProject(projectId: string): Promise<{
  project: StoredProject
  scanError: string | null
}> {
  const project = getProject(projectId)
  if (!project) throw new Error("Project not found")

  const snapshots = await snapshotsForRepos(project.repos)

  try {
    const { report } = await analyzeProjectReposViaCli({
      projectName: project.name,
      cacheDir: path.join(resolveProjectDataDir(), "cache", project.id),
      repos: project.repos.map((repo) => ({
        id: repo.id,
        name: repo.name,
        root: repo.root,
        role: repo.role,
      })),
    })

    return {
      project: recordSuccessfulScan(project.id, report, snapshots),
      scanError: null,
    }
  } catch (error) {
    return {
      project: recordFailedScan(project.id, errorMessage(error), snapshots),
      scanError: errorMessage(error),
    }
  }
}

export async function scanProjectPayload(projectId: string): Promise<
  ProjectsPayload & { scanError: string | null }
> {
  const { scanError } = await scanProject(projectId)
  return {
    ...(await projectsPayload()),
    scanError,
  }
}

export async function createAndScanProjectPayload(
  input: CreateProjectRequest,
): Promise<ProjectsPayload & { scanError: string | null }> {
  const repos = validateProjectRequest(input)
  const project = createProject({
    name: input.name.trim(),
    repos,
  })
  setActiveProject(project.id)

  const { scanError } = await scanProject(project.id)

  return {
    ...(await projectsPayload()),
    scanError,
  }
}

function reposFromReport(report: Report): ProjectRepoInfo[] {
  if (report.project.repos?.length) return report.project.repos

  const root = report.project.root || process.cwd()
  const id = slugify(path.basename(root), "repo")

  return [
    {
      id,
      name: titleFromSlug(id),
      root,
      role: inferRole(report.project.stack),
      stack: report.project.stack,
    },
  ]
}

export async function importReportPayload(
  report: Report,
): Promise<ProjectsPayload & { scanError: null }> {
  const repos = reposFromReport(report).map((repo) => ({
    id: slugify(repo.id, "repo"),
    name: repo.name,
    root: path.resolve(repo.root),
    role: repo.role,
  }))
  const project = createProject({
    name: report.project.name || "Imported report",
    repos,
  })
  const snapshots = await snapshotsForRepos(project.repos)
  const normalizedReport: Report = {
    ...report,
    project: {
      ...report.project,
      root: repos.map((repo) => repo.root).join(path.delimiter),
      repos: repos.map((repo) => ({
        ...repo,
        stack:
          report.project.repos?.find((reportRepo) => reportRepo.id === repo.id)?.stack ??
          report.project.stack,
      })),
    },
  }

  recordSuccessfulScan(project.id, normalizedReport, snapshots)
  setActiveProject(project.id)

  return {
    ...(await projectsPayload()),
    scanError: null,
  }
}
