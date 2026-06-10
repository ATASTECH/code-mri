"use client"

import type { ProjectRepoRole, Report, ReportDiff } from "@code-mri/shared-types"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

export interface ProjectRepoDraft {
  id?: string
  name?: string
  root: string
  role?: ProjectRepoRole
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

export interface ProjectMetricSnapshot {
  scanId: string
  projectId: string
  finishedAt: string | null
  health: number
  issueCount: number
  deadCodeCount: number
  circularCount: number
  endpointCount: number
  hotspotCount: number
  complexityTotal: number
  coveragePct: number | null
}

export interface ProjectTrendPayload {
  snapshots: ProjectMetricSnapshot[]
  latest: ProjectMetricSnapshot | null
  previous: ProjectMetricSnapshot | null
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

interface ProjectsPayload {
  projects: ProjectSummary[]
  activeProjectId: string | null
  activeReport: Report | null
  activeReportDiff: ActiveReportDiffPayload | null
  activeTrend: ProjectTrendPayload | null
  activeRegressionAlerts: RegressionAlertPayload[]
  scanError?: string | null
  error?: string
}

export interface UseReport {
  report: Report | null
  activeReportDiff: ActiveReportDiffPayload | null
  activeTrend: ProjectTrendPayload | null
  activeRegressionAlerts: RegressionAlertPayload[]
  projects: ProjectSummary[]
  activeProjectId: string | null
  error: string | null
  loading: boolean
  scanningProjectId: string | null
  loadFromText: (text: string) => Promise<void>
  createProject: (input: {
    name: string
    repos: ProjectRepoDraft[]
  }) => Promise<void>
  updateProject: (
    projectId: string,
    input: {
      name: string
      repos: ProjectRepoDraft[]
    },
  ) => Promise<void>
  refreshProject: (projectId: string) => Promise<void>
  selectProject: (projectId: string) => Promise<void>
  updateProjectSettings: (
    projectId: string,
    input: { autoScanOnChange: boolean },
  ) => Promise<void>
}

async function readPayload(response: Response): Promise<ProjectsPayload> {
  const payload = (await response.json()) as ProjectsPayload

  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed")
  }

  return payload
}

export function useReport(): UseReport {
  const [report, setReport] = useState<Report | null>(null)
  const [activeReportDiff, setActiveReportDiff] =
    useState<ActiveReportDiffPayload | null>(null)
  const [activeTrend, setActiveTrend] = useState<ProjectTrendPayload | null>(
    null
  )
  const [activeRegressionAlerts, setActiveRegressionAlerts] = useState<
    RegressionAlertPayload[]
  >([])
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [scanningProjectId, setScanningProjectId] = useState<string | null>(
    null
  )
  const scanningProjectIdRef = useRef<string | null>(null)
  const autoScanSnapshotRef = useRef<string | null>(null)

  useEffect(() => {
    scanningProjectIdRef.current = scanningProjectId
  }, [scanningProjectId])

  const applyPayload = useCallback((payload: ProjectsPayload) => {
    setProjects(payload.projects)
    setActiveProjectId(payload.activeProjectId)
    setReport(payload.activeReport)
    setActiveReportDiff(payload.activeReportDiff)
    setActiveTrend(payload.activeTrend)
    setActiveRegressionAlerts(payload.activeRegressionAlerts ?? [])
    setError(payload.scanError ?? null)
  }, [])

  const fetchProjects = useCallback(async () => {
    if (scanningProjectIdRef.current) return

    const payload = await fetch("/api/projects").then(readPayload)
    applyPayload(payload)
  }, [applyPayload])

  useEffect(() => {
    let active = true
    fetchProjects()
      .catch((e: unknown) => {
        if (active) {
          setError(`Could not load projects: ${(e as Error).message}`)
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [fetchProjects])

  useEffect(() => {
    const refreshOnFocus = () => {
      if (document.visibilityState === "visible") {
        void fetchProjects().catch((e: unknown) => {
          setError(`Could not refresh projects: ${(e as Error).message}`)
        })
      }
    }

    window.addEventListener("focus", refreshOnFocus)
    document.addEventListener("visibilitychange", refreshOnFocus)

    return () => {
      window.removeEventListener("focus", refreshOnFocus)
      document.removeEventListener("visibilitychange", refreshOnFocus)
    }
  }, [fetchProjects])

  const loadFromText = useCallback(
    async (text: string) => {
      try {
        const parsed = JSON.parse(text) as Report
        const payload = await fetch("/api/reports/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed),
        }).then(readPayload)

        applyPayload(payload)
      } catch (e) {
        setError(`Invalid report JSON: ${(e as Error).message}`)
      }
    },
    [applyPayload]
  )

  const createProject = useCallback(
    async (input: { name: string; repos: ProjectRepoDraft[] }) => {
      setScanningProjectId("new")
      setError(null)
      try {
        const payload = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }).then(readPayload)
        applyPayload(payload)
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setScanningProjectId(null)
      }
    },
    [applyPayload]
  )

  const refreshProject = useCallback(
    async (projectId: string) => {
      setScanningProjectId(projectId)
      setError(null)
      try {
        const payload = await fetch(`/api/projects/${projectId}/scan`, {
          method: "POST",
        }).then(readPayload)
        applyPayload(payload)
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setScanningProjectId(null)
      }
    },
    [applyPayload]
  )

  const updateProject = useCallback(
    async (
      projectId: string,
      input: { name: string; repos: ProjectRepoDraft[] },
    ) => {
      setError(null)
      try {
        const payload = await fetch(`/api/projects/${projectId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }).then(readPayload)
        applyPayload(payload)
      } catch (e) {
        setError((e as Error).message)
        throw e
      }
    },
    [applyPayload]
  )

  const updateProjectSettings = useCallback(
    async (
      projectId: string,
      input: { autoScanOnChange: boolean },
    ) => {
      setError(null)
      try {
        const payload = await fetch(`/api/projects/${projectId}/settings`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }).then(readPayload)
        applyPayload(payload)
      } catch (e) {
        setError((e as Error).message)
      }
    },
    [applyPayload]
  )

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [activeProjectId, projects]
  )
  const activeStaleSnapshot = useMemo(() => {
    if (!activeProject?.staleRepos.length) return null

    return [
      activeProject.id,
      ...activeProject.staleRepos.map((repo) =>
        [
          repo.id,
          repo.previousGitHead ?? "",
          repo.currentGitHead ?? "",
          repo.previousGitDirty ? "1" : "0",
          repo.currentGitDirty ? "1" : "0",
        ].join(":")
      ),
    ].join("|")
  }, [activeProject])

  useEffect(() => {
    if (!activeProject?.autoScanOnChange) return
    if (!activeProject.needsRefresh) return
    if (!activeStaleSnapshot) return
    if (scanningProjectId) return
    if (autoScanSnapshotRef.current === activeStaleSnapshot) return

    autoScanSnapshotRef.current = activeStaleSnapshot
    void refreshProject(activeProject.id)
  }, [activeProject, activeStaleSnapshot, refreshProject, scanningProjectId])

  const selectProject = useCallback(
    async (projectId: string) => {
      setError(null)
      try {
        const payload = await fetch(`/api/projects/${projectId}/select`, {
          method: "POST",
        }).then(readPayload)
        applyPayload(payload)
      } catch (e) {
        setError((e as Error).message)
      }
    },
    [applyPayload]
  )

  return {
    report,
    activeReportDiff,
    activeTrend,
    activeRegressionAlerts,
    projects,
    activeProjectId,
    error,
    loading,
    scanningProjectId,
    loadFromText,
    createProject,
    updateProject,
    refreshProject,
    selectProject,
    updateProjectSettings,
  }
}
