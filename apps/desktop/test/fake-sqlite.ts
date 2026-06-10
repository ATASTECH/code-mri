type Row = Record<string, unknown>

interface Store {
  projects: Row[]
  projectRepos: Row[]
  scanRuns: Row[]
  scanRunRepos: Row[]
  scanMetrics: Row[]
  settings: Row[]
}

function normalize(sql: string): string {
  return sql.replace(/\s+/g, " ").trim()
}

function sortText(a: unknown, b: unknown): number {
  return String(a ?? "").localeCompare(String(b ?? ""))
}

class StatementSync {
  constructor(
    private readonly store: Store,
    private readonly sql: string,
  ) {}

  all(...params: unknown[]): Row[] {
    const sql = normalize(this.sql)

    if (sql.startsWith("PRAGMA table_info(projects)")) {
      return [{ name: "auto_scan_on_change" }]
    }

    if (sql.startsWith("SELECT * FROM project_repos WHERE project_id = ?")) {
      const [projectId] = params
      return this.store.projectRepos
        .filter((repo) => repo.project_id === projectId)
        .sort((a, b) => sortText(a.created_at, b.created_at) || sortText(a.id, b.id))
        .map((repo) => ({ ...repo }))
    }

    if (sql.startsWith("SELECT * FROM projects ORDER BY updated_at DESC")) {
      return this.store.projects
        .toSorted((a, b) => sortText(b.updated_at, a.updated_at))
        .map((project) => ({ ...project }))
    }

    if (sql.startsWith("SELECT * FROM scan_metrics")) {
      const [projectId, limit] = params
      return this.store.scanMetrics
        .filter((metric) => metric.project_id === projectId)
        .toReversed()
        .toSorted((a, b) => sortText(b.finished_at, a.finished_at))
        .slice(0, Number(limit ?? 12))
        .map((metric) => ({ ...metric }))
    }

    if (sql.startsWith("SELECT id, finished_at, report_json FROM scan_runs")) {
      const [projectId, limit] = params
      return this.store.scanRuns
        .filter(
          (item) =>
            item.project_id === projectId &&
            item.status === "success" &&
            item.report_json
        )
        .toReversed()
        .toSorted((a, b) => sortText(b.finished_at, a.finished_at))
        .slice(0, Number(limit ?? 12))
        .map((item) => ({
          id: item.id,
          finished_at: item.finished_at,
          report_json: item.report_json,
        }))
    }

    return []
  }

  get(...params: unknown[]): Row | undefined {
    const sql = normalize(this.sql)

    if (sql.startsWith("SELECT report_json FROM scan_runs")) {
      const [scanId] = params
      const run = this.store.scanRuns.find(
        (item) => item.id === scanId && item.status === "success"
      )
      return run ? { report_json: run.report_json } : undefined
    }

    if (sql.startsWith("SELECT id, finished_at, report_json FROM scan_runs")) {
      const [projectId, latestScanId] = params
      return this.store.scanRuns
        .filter(
          (item) =>
            item.project_id === projectId &&
            item.status === "success" &&
            item.report_json &&
            item.id !== latestScanId
        )
        .toReversed()
        .toSorted((a, b) => sortText(b.finished_at, a.finished_at))
        .map((item) => ({
          id: item.id,
          finished_at: item.finished_at,
          report_json: item.report_json,
        }))[0]
    }

    if (sql.startsWith("SELECT * FROM projects WHERE id = ?")) {
      const [projectId] = params
      const project = this.store.projects.find((item) => item.id === projectId)
      return project ? { ...project } : undefined
    }

    if (sql.startsWith("SELECT value FROM settings WHERE key = ?")) {
      const [key] = params
      const setting = this.store.settings.find((item) => item.key === key)
      return setting ? { value: setting.value } : undefined
    }

    return undefined
  }

  run(...params: unknown[]): unknown {
    const sql = normalize(this.sql)

    if (sql.startsWith("INSERT INTO settings")) {
      const [value] = params
      const existing = this.store.settings.find((item) => item.key === "active_project")
      if (existing) existing.value = value
      else this.store.settings.push({ key: "active_project", value })
      return {}
    }

    if (sql.startsWith("INSERT INTO projects")) {
      const [id, name, createdAt, updatedAt] = params
      this.store.projects.push({
        id,
        name,
        auto_scan_on_change: 0,
        latest_scan_id: null,
        status: "idle",
        error: null,
        last_scanned_at: null,
        created_at: createdAt,
        updated_at: updatedAt,
      })
      return {}
    }

    if (sql.startsWith("INSERT INTO project_repos")) {
      if (sql.includes("git_head")) {
        const [
          projectId,
          id,
          name,
          root,
          role,
          stackJson,
          gitHead,
          gitDirty,
          createdAt,
          updatedAt,
        ] = params
        this.store.projectRepos.push({
          project_id: projectId,
          id,
          name,
          root,
          role,
          stack_json: stackJson,
          git_head: gitHead,
          git_dirty: gitDirty,
          created_at: createdAt,
          updated_at: updatedAt,
        })
      } else {
        const [projectId, id, name, root, role, createdAt, updatedAt] = params
        this.store.projectRepos.push({
          project_id: projectId,
          id,
          name,
          root,
          role,
          stack_json: "[]",
          git_head: null,
          git_dirty: 0,
          created_at: createdAt,
          updated_at: updatedAt,
        })
      }
      return {}
    }

    if (sql.startsWith("UPDATE projects SET auto_scan_on_change")) {
      const [autoScan, updatedAt, projectId] = params
      const project = this.store.projects.find((item) => item.id === projectId)
      if (project) {
        project.auto_scan_on_change = autoScan
        project.updated_at = updatedAt
      }
      return {}
    }

    if (sql.startsWith("UPDATE projects SET name")) {
      const [name, updatedAt, projectId] = params
      const project = this.store.projects.find((item) => item.id === projectId)
      if (project) {
        project.name = name
        project.updated_at = updatedAt
      }
      return {}
    }

    if (sql.startsWith("DELETE FROM project_repos")) {
      const [projectId] = params
      this.store.projectRepos = this.store.projectRepos.filter(
        (repo) => repo.project_id !== projectId
      )
      return {}
    }

    if (sql.startsWith("INSERT INTO scan_runs")) {
      if (sql.includes("report_json")) {
        const [id, projectId, startedAt, finishedAt, reportJson] = params
        this.store.scanRuns.push({
          id,
          project_id: projectId,
          status: "success",
          started_at: startedAt,
          finished_at: finishedAt,
          report_json: reportJson,
          error: null,
        })
      } else {
        const [id, projectId, startedAt, finishedAt, error] = params
        this.store.scanRuns.push({
          id,
          project_id: projectId,
          status: "error",
          started_at: startedAt,
          finished_at: finishedAt,
          report_json: null,
          error,
        })
      }
      return {}
    }

    if (sql.startsWith("INSERT INTO scan_run_repos")) {
      if (sql.includes("error")) {
        const [id, scanRunId, projectId, repoId, gitHead, gitDirty, error] = params
        this.store.scanRunRepos.push({
          id,
          scan_run_id: scanRunId,
          project_id: projectId,
          repo_id: repoId,
          status: "error",
          git_head: gitHead,
          git_dirty: gitDirty,
          error,
        })
      } else {
        const [id, scanRunId, projectId, repoId, gitHead, gitDirty] = params
        this.store.scanRunRepos.push({
          id,
          scan_run_id: scanRunId,
          project_id: projectId,
          repo_id: repoId,
          status: "success",
          git_head: gitHead,
          git_dirty: gitDirty,
          error: null,
        })
      }
      return {}
    }

    if (sql.startsWith("INSERT INTO scan_metrics")) {
      const [
        scanId,
        projectId,
        finishedAt,
        health,
        issueCount,
        deadCodeCount,
        circularCount,
        endpointCount,
        hotspotCount,
        complexityTotal,
        coveragePct,
      ] = params
      this.store.scanMetrics.push({
        scan_id: scanId,
        project_id: projectId,
        finished_at: finishedAt,
        health,
        issue_count: issueCount,
        dead_code_count: deadCodeCount,
        circular_count: circularCount,
        endpoint_count: endpointCount,
        hotspot_count: hotspotCount,
        complexity_total: complexityTotal,
        coverage_pct: coveragePct,
      })
      return {}
    }

    if (sql.startsWith("UPDATE scan_runs SET report_json = NULL")) {
      const [projectId, , limit] = params
      const retained = new Set(
        this.store.scanRuns
          .filter(
            (run) =>
              run.project_id === projectId &&
              run.status === "success" &&
              run.report_json
          )
          .toReversed()
          .toSorted((a, b) => sortText(b.finished_at, a.finished_at))
          .slice(0, Number(limit))
          .map((run) => run.id)
      )
      for (const run of this.store.scanRuns) {
        if (
          run.project_id === projectId &&
          run.status === "success" &&
          run.report_json &&
          !retained.has(run.id)
        ) {
          run.report_json = null
        }
      }
      return {}
    }

    if (sql.startsWith("UPDATE project_repos SET stack_json")) {
      const [stackJson, gitHead, gitDirty, updatedAt, projectId, repoId] = params
      const repo = this.store.projectRepos.find(
        (item) => item.project_id === projectId && item.id === repoId
      )
      if (repo) {
        repo.stack_json = stackJson
        repo.git_head = gitHead
        repo.git_dirty = gitDirty
        repo.updated_at = updatedAt
      }
      return {}
    }

    if (sql.startsWith("UPDATE projects SET latest_scan_id")) {
      const [latestScanId, lastScannedAt, updatedAt, projectId] = params
      const project = this.store.projects.find((item) => item.id === projectId)
      if (project) {
        project.latest_scan_id = latestScanId
        project.status = "success"
        project.error = null
        project.last_scanned_at = lastScannedAt
        project.updated_at = updatedAt
      }
      return {}
    }

    if (sql.startsWith("UPDATE projects SET status = 'error'")) {
      const [error, updatedAt, projectId] = params
      const project = this.store.projects.find((item) => item.id === projectId)
      if (project) {
        project.status = "error"
        project.error = error
        project.updated_at = updatedAt
      }
      return {}
    }

    return {}
  }
}

export class DatabaseSync {
  private store: Store = {
    projects: [],
    projectRepos: [],
    scanRuns: [],
    scanRunRepos: [],
    scanMetrics: [],
    settings: [],
  }

  constructor() {}

  exec(): void {}

  prepare(sql: string): StatementSync {
    return new StatementSync(this.store, sql)
  }

  close(): void {}
}
