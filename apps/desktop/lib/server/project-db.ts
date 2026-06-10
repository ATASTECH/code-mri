import "server-only"

import { randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"
import { homedir } from "node:os"
import * as path from "node:path"
import { DatabaseSync } from "node:sqlite"
import type { ProjectRepoRole, Report } from "@code-mri/shared-types"

export type ProjectScanStatus = "idle" | "success" | "error"

export interface StoredProjectRepo {
  id: string
  projectId: string
  name: string
  root: string
  role: ProjectRepoRole
  stack: string[]
  gitHead: string | null
  gitDirty: boolean
  createdAt: string
  updatedAt: string
}

export interface StoredProject {
  id: string
  name: string
  autoScanOnChange: boolean
  latestScanId: string | null
  status: ProjectScanStatus
  error: string | null
  lastScannedAt: string | null
  createdAt: string
  updatedAt: string
  repos: StoredProjectRepo[]
  latestReport: Report | null
}

export interface StoredReportSnapshot {
  scanId: string
  finishedAt: string | null
  report: Report
}

export interface StoredMetricSnapshot {
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

export interface CreateProjectInput {
  name: string
  repos: Array<{
    id: string
    name: string
    root: string
    role: ProjectRepoRole
  }>
}

export type UpdateProjectInput = CreateProjectInput

export interface RepoGitSnapshot {
  repoId: string
  gitHead: string | null
  gitDirty: boolean
  error?: string | null
}

let database: DatabaseSync | null = null

function defaultAppDataDir(): string {
  if (process.platform === "darwin") {
    return path.join(homedir(), "Library", "Application Support", "Code MRI")
  }

  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA ?? path.join(homedir(), "AppData", "Roaming"),
      "Code MRI",
    )
  }

  return path.join(
    process.env.XDG_DATA_HOME ?? path.join(homedir(), ".local", "share"),
    "code-mri",
  )
}

export function resolveProjectDataDir(): string {
  return process.env.CODE_MRI_APP_DATA_DIR ?? defaultAppDataDir()
}

export function resolveProjectDatabasePath(): string {
  if (process.env.CODE_MRI_DB_PATH) return process.env.CODE_MRI_DB_PATH

  if (
    process.env.CODE_MRI_APP_DATA_DIR ||
    process.env.NODE_ENV === "production"
  ) {
    return path.join(resolveProjectDataDir(), "code-mri.sqlite")
  }

  return path.join(process.cwd(), ".code-mri", "code-mri.sqlite")
}

function getDatabase(): DatabaseSync {
  if (!database) {
    const filename = resolveProjectDatabasePath()
    mkdirSync(path.dirname(filename), { recursive: true })
    database = new DatabaseSync(filename)
    database.exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        auto_scan_on_change INTEGER NOT NULL DEFAULT 0,
        latest_scan_id TEXT,
        status TEXT NOT NULL DEFAULT 'idle',
        error TEXT,
        last_scanned_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS project_repos (
        project_id TEXT NOT NULL,
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        root TEXT NOT NULL,
        role TEXT NOT NULL,
        stack_json TEXT NOT NULL DEFAULT '[]',
        git_head TEXT,
        git_dirty INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, id),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS scan_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        report_json TEXT,
        error TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS scan_run_repos (
        id TEXT PRIMARY KEY,
        scan_run_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        repo_id TEXT NOT NULL,
        status TEXT NOT NULL,
        git_head TEXT,
        git_dirty INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        FOREIGN KEY (scan_run_id) REFERENCES scan_runs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS scan_metrics (
        scan_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        finished_at TEXT,
        health INTEGER NOT NULL,
        issue_count INTEGER NOT NULL,
        dead_code_count INTEGER NOT NULL,
        circular_count INTEGER NOT NULL,
        endpoint_count INTEGER NOT NULL,
        hotspot_count INTEGER NOT NULL,
        complexity_total INTEGER NOT NULL,
        coverage_pct REAL,
        FOREIGN KEY (scan_id) REFERENCES scan_runs(id) ON DELETE CASCADE,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)

    const projectColumns = database.prepare("PRAGMA table_info(projects)").all()
    const hasAutoScanColumn = projectColumns.some(
      (column) => column.name === "auto_scan_on_change",
    )
    if (!hasAutoScanColumn) {
      database.exec(
        "ALTER TABLE projects ADD COLUMN auto_scan_on_change INTEGER NOT NULL DEFAULT 0",
      )
    }
  }

  return database
}

export function resetProjectDatabaseForTests(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("resetProjectDatabaseForTests can only run in tests")
  }

  database?.close()
  database = null
}

function now(): string {
  return new Date().toISOString()
}

function id(prefix: string): string {
  return `${prefix}_${randomUUID()}`
}

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  return typeof value === "string" ? value : ""
}

function nullableText(row: Record<string, unknown>, key: string): string | null {
  const value = row[key]
  return typeof value === "string" && value.length > 0 ? value : null
}

function bool(row: Record<string, unknown>, key: string): boolean {
  return Number(row[key] ?? 0) === 1
}

function nullableNumber(row: Record<string, unknown>, key: string): number | null {
  const value = row[key]
  return typeof value === "number" ? value : null
}

function parseStack(value: unknown): string[] {
  if (typeof value !== "string") return []

  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : []
  } catch {
    return []
  }
}

function parseReport(value: unknown): Report | null {
  if (typeof value !== "string" || value.length === 0) return null

  try {
    return JSON.parse(value) as Report
  } catch {
    return null
  }
}

function mapRepo(row: Record<string, unknown>): StoredProjectRepo {
  return {
    id: text(row, "id"),
    projectId: text(row, "project_id"),
    name: text(row, "name"),
    root: text(row, "root"),
    role: text(row, "role") as ProjectRepoRole,
    stack: parseStack(row.stack_json),
    gitHead: nullableText(row, "git_head"),
    gitDirty: bool(row, "git_dirty"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
  }
}

function projectRepos(projectId: string): StoredProjectRepo[] {
  const db = getDatabase()
  return db
    .prepare(
      "SELECT * FROM project_repos WHERE project_id = ? ORDER BY created_at ASC",
    )
    .all(projectId)
    .map(mapRepo)
}

function projectReport(latestScanId: string | null): Report | null {
  if (!latestScanId) return null

  const db = getDatabase()
  const row = db
    .prepare("SELECT report_json FROM scan_runs WHERE id = ? AND status = 'success'")
    .get(latestScanId)

  return row ? parseReport(row.report_json) : null
}

function mapReportSnapshot(row: Record<string, unknown>): StoredReportSnapshot | null {
  const report = parseReport(row.report_json)
  if (!report) return null

  return {
    scanId: text(row, "id"),
    finishedAt: nullableText(row, "finished_at"),
    report,
  }
}

function mapMetricSnapshot(row: Record<string, unknown>): StoredMetricSnapshot {
  return {
    scanId: text(row, "scan_id"),
    projectId: text(row, "project_id"),
    finishedAt: nullableText(row, "finished_at"),
    health: Number(row.health ?? 0),
    issueCount: Number(row.issue_count ?? 0),
    deadCodeCount: Number(row.dead_code_count ?? 0),
    circularCount: Number(row.circular_count ?? 0),
    endpointCount: Number(row.endpoint_count ?? 0),
    hotspotCount: Number(row.hotspot_count ?? 0),
    complexityTotal: Number(row.complexity_total ?? 0),
    coveragePct: nullableNumber(row, "coverage_pct"),
  }
}

function metricSnapshotForReport(
  scanId: string,
  projectId: string,
  finishedAt: string,
  report: Report,
): StoredMetricSnapshot {
  const coverage = report.insights?.coverage ?? []
  const covered = coverage.reduce((sum, item) => sum + item.covered, 0)
  const total = coverage.reduce((sum, item) => sum + item.total, 0)

  return {
    scanId,
    projectId,
    finishedAt,
    health: report.scores.health,
    issueCount: report.issues.length,
    deadCodeCount: report.issues.filter((issue) => issue.kind === "DEAD_CODE").length,
    circularCount: report.issues.filter((issue) => issue.kind === "CIRCULAR_DEPENDENCY").length,
    endpointCount: report.summary.endpoints,
    hotspotCount: report.insights?.hotspots.length ?? 0,
    complexityTotal:
      report.insights?.hotspots.reduce((sum, item) => sum + item.complexity, 0) ?? 0,
    coveragePct: total > 0 ? Math.round((covered / total) * 1000) / 10 : null,
  }
}

const DEFAULT_REPORT_RETENTION = 20

function reportRetentionLimit(): number {
  const raw = Number(process.env.CODE_MRI_REPORT_RETENTION)
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_REPORT_RETENTION
}

// Metric rows in scan_metrics are kept forever; only the raw report payloads
// beyond the retention window are dropped.
function pruneOldScanReports(projectId: string): void {
  const db = getDatabase()
  db.prepare(
    `UPDATE scan_runs SET report_json = NULL
     WHERE project_id = ?
       AND status = 'success'
       AND report_json IS NOT NULL
       AND id NOT IN (
         SELECT id FROM scan_runs
         WHERE project_id = ?
           AND status = 'success'
           AND report_json IS NOT NULL
         ORDER BY finished_at DESC, rowid DESC
         LIMIT ?
       )`,
  ).run(projectId, projectId, reportRetentionLimit())
}

function recordMetricSnapshot(snapshot: StoredMetricSnapshot): void {
  const db = getDatabase()
  db.prepare(
    `INSERT INTO scan_metrics(
      scan_id, project_id, finished_at, health, issue_count, dead_code_count,
      circular_count, endpoint_count, hotspot_count, complexity_total, coverage_pct
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    snapshot.scanId,
    snapshot.projectId,
    snapshot.finishedAt,
    snapshot.health,
    snapshot.issueCount,
    snapshot.deadCodeCount,
    snapshot.circularCount,
    snapshot.endpointCount,
    snapshot.hotspotCount,
    snapshot.complexityTotal,
    snapshot.coveragePct,
  )
}

export function listProjectMetricSnapshots(
  projectId: string,
  limit = 12,
): StoredMetricSnapshot[] {
  const db = getDatabase()
  return db
    .prepare(
      `SELECT *
       FROM scan_metrics
       WHERE project_id = ?
       ORDER BY finished_at DESC, rowid DESC
       LIMIT ?`,
    )
    .all(projectId, limit)
    .map(mapMetricSnapshot)
    .reverse()
}

export function listProjectReportSnapshots(
  projectId: string,
  limit = 12,
): StoredReportSnapshot[] {
  const db = getDatabase()
  return db
    .prepare(
      `SELECT id, finished_at, report_json
       FROM scan_runs
       WHERE project_id = ?
         AND status = 'success'
         AND report_json IS NOT NULL
       ORDER BY finished_at DESC, rowid DESC
       LIMIT ?`,
    )
    .all(projectId, limit)
    .map(mapReportSnapshot)
    .filter((snapshot): snapshot is StoredReportSnapshot => snapshot !== null)
    .reverse()
}

export function previousSuccessfulReportSnapshot(
  projectId: string,
  latestScanId: string | null,
): StoredReportSnapshot | null {
  if (!latestScanId) return null

  const db = getDatabase()
  const row = db
    .prepare(
      `SELECT id, finished_at, report_json
       FROM scan_runs
       WHERE project_id = ?
         AND status = 'success'
         AND report_json IS NOT NULL
         AND id != ?
       ORDER BY finished_at DESC, rowid DESC
       LIMIT 1`,
    )
    .get(projectId, latestScanId)

  return row ? mapReportSnapshot(row) : null
}

function mapProject(row: Record<string, unknown>): StoredProject {
  const latestScanId = nullableText(row, "latest_scan_id")

  return {
    id: text(row, "id"),
    name: text(row, "name"),
    autoScanOnChange: bool(row, "auto_scan_on_change"),
    latestScanId,
    status: (text(row, "status") || "idle") as ProjectScanStatus,
    error: nullableText(row, "error"),
    lastScannedAt: nullableText(row, "last_scanned_at"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
    repos: projectRepos(text(row, "id")),
    latestReport: projectReport(latestScanId),
  }
}

export function listProjects(): StoredProject[] {
  const db = getDatabase()
  return db
    .prepare("SELECT * FROM projects ORDER BY updated_at DESC")
    .all()
    .map(mapProject)
}

export function getProject(projectId: string): StoredProject | null {
  const db = getDatabase()
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId)
  return row ? mapProject(row) : null
}

export function getActiveProjectId(): string | null {
  const db = getDatabase()
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("active_project")
  return row ? nullableText(row, "value") : null
}

export function setActiveProject(projectId: string): void {
  const db = getDatabase()
  db.prepare(
    "INSERT INTO settings(key, value) VALUES('active_project', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(projectId)
}

export function createProject(input: CreateProjectInput): StoredProject {
  const db = getDatabase()
  const projectId = id("project")
  const timestamp = now()

  db.exec("BEGIN")
  try {
    db.prepare(
      "INSERT INTO projects(id, name, status, created_at, updated_at) VALUES(?, ?, 'idle', ?, ?)",
    ).run(projectId, input.name, timestamp, timestamp)

    for (const repo of input.repos) {
      db.prepare(
        `INSERT INTO project_repos(
          project_id, id, name, root, role, stack_json, created_at, updated_at
        ) VALUES(?, ?, ?, ?, ?, '[]', ?, ?)`,
      ).run(
        projectId,
        repo.id,
        repo.name,
        repo.root,
        repo.role,
        timestamp,
        timestamp,
      )
    }

    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }

  return getProject(projectId) as StoredProject
}

export function updateProjectSettings(
  projectId: string,
  input: { autoScanOnChange: boolean },
): StoredProject {
  const db = getDatabase()
  const timestamp = now()

  db.prepare(
    "UPDATE projects SET auto_scan_on_change = ?, updated_at = ? WHERE id = ?",
  ).run(input.autoScanOnChange ? 1 : 0, timestamp, projectId)

  const project = getProject(projectId)
  if (!project) throw new Error("Project not found")

  return project
}

export function updateProject(
  projectId: string,
  input: UpdateProjectInput,
): StoredProject {
  const db = getDatabase()
  const timestamp = now()
  const existingProject = getProject(projectId)
  if (!existingProject) throw new Error("Project not found")

  const existingRepos = new Map(
    existingProject.repos.map((repo) => [repo.id, repo]),
  )

  db.exec("BEGIN")
  try {
    db.prepare("UPDATE projects SET name = ?, updated_at = ? WHERE id = ?").run(
      input.name,
      timestamp,
      projectId,
    )

    db.prepare("DELETE FROM project_repos WHERE project_id = ?").run(projectId)

    for (const repo of input.repos) {
      const existingRepo = existingRepos.get(repo.id)

      db.prepare(
        `INSERT INTO project_repos(
          project_id, id, name, root, role, stack_json, git_head, git_dirty, created_at, updated_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        projectId,
        repo.id,
        repo.name,
        repo.root,
        repo.role,
        JSON.stringify(existingRepo?.stack ?? []),
        existingRepo?.gitHead ?? null,
        existingRepo?.gitDirty ? 1 : 0,
        existingRepo?.createdAt ?? timestamp,
        timestamp,
      )
    }

    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }

  return getProject(projectId) as StoredProject
}

export function recordSuccessfulScan(
  projectId: string,
  report: Report,
  snapshots: RepoGitSnapshot[],
): StoredProject {
  const db = getDatabase()
  const scanId = id("scan")
  const timestamp = now()
  const snapshotByRepo = new Map(snapshots.map((snapshot) => [snapshot.repoId, snapshot]))
  const stackByRepo = new Map(
    (report.project.repos ?? []).map((repo) => [repo.id, repo.stack]),
  )

  db.exec("BEGIN")
  try {
    db.prepare(
      `INSERT INTO scan_runs(
        id, project_id, status, started_at, finished_at, report_json
      ) VALUES(?, ?, 'success', ?, ?, ?)`,
    ).run(scanId, projectId, timestamp, timestamp, JSON.stringify(report))

    recordMetricSnapshot(metricSnapshotForReport(scanId, projectId, timestamp, report))
    pruneOldScanReports(projectId)

    for (const snapshot of snapshots) {
      db.prepare(
        `INSERT INTO scan_run_repos(
          id, scan_run_id, project_id, repo_id, status, git_head, git_dirty
        ) VALUES(?, ?, ?, ?, 'success', ?, ?)`,
      ).run(
        id("scan_repo"),
        scanId,
        projectId,
        snapshot.repoId,
        snapshot.gitHead,
        snapshot.gitDirty ? 1 : 0,
      )
    }

    const repos = projectRepos(projectId)
    for (const repo of repos) {
      const snapshot = snapshotByRepo.get(repo.id)
      const stack = stackByRepo.get(repo.id) ?? repo.stack
      db.prepare(
        `UPDATE project_repos
         SET stack_json = ?, git_head = ?, git_dirty = ?, updated_at = ?
         WHERE project_id = ? AND id = ?`,
      ).run(
        JSON.stringify(stack),
        snapshot?.gitHead ?? null,
        snapshot?.gitDirty ? 1 : 0,
        timestamp,
        projectId,
        repo.id,
      )
    }

    db.prepare(
      `UPDATE projects
       SET latest_scan_id = ?, status = 'success', error = NULL,
           last_scanned_at = ?, updated_at = ?
       WHERE id = ?`,
    ).run(scanId, timestamp, timestamp, projectId)

    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }

  return getProject(projectId) as StoredProject
}

export function recordFailedScan(
  projectId: string,
  errorMessage: string,
  snapshots: RepoGitSnapshot[] = [],
): StoredProject {
  const db = getDatabase()
  const scanId = id("scan")
  const timestamp = now()

  db.exec("BEGIN")
  try {
    db.prepare(
      `INSERT INTO scan_runs(
        id, project_id, status, started_at, finished_at, error
      ) VALUES(?, ?, 'error', ?, ?, ?)`,
    ).run(scanId, projectId, timestamp, timestamp, errorMessage)

    for (const snapshot of snapshots) {
      db.prepare(
        `INSERT INTO scan_run_repos(
          id, scan_run_id, project_id, repo_id, status, git_head, git_dirty, error
        ) VALUES(?, ?, ?, ?, 'error', ?, ?, ?)`,
      ).run(
        id("scan_repo"),
        scanId,
        projectId,
        snapshot.repoId,
        snapshot.gitHead,
        snapshot.gitDirty ? 1 : 0,
        snapshot.error ?? errorMessage,
      )
    }

    db.prepare(
      "UPDATE projects SET status = 'error', error = ?, updated_at = ? WHERE id = ?",
    ).run(errorMessage, timestamp, projectId)

    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }

  return getProject(projectId) as StoredProject
}
