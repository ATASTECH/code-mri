import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import * as path from "node:path"
import type { ProjectRepoRole, Report } from "@code-mri/engine"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const gitStates = vi.hoisted(
  () => new Map<string, { gitHead: string | null; gitDirty: boolean }>()
)
const analyzeProjectReposMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/server/git-state", () => ({
  readGitState: vi.fn(async (root: string) => {
    return gitStates.get(root) ?? { gitHead: null, gitDirty: false }
  }),
}))

vi.mock("@/lib/server/engine-runner", () => ({
  analyzeProjectReposViaCli: analyzeProjectReposMock,
}))

import {
  listProjectMetricSnapshots,
  listProjectReportSnapshots,
  resetProjectDatabaseForTests,
  resolveProjectDatabasePath,
} from "@/lib/server/project-db"
import {
  createAndScanProjectPayload,
  projectsPayload,
  scanProjectPayload,
  selectProjectPayload,
  updateProjectPayload,
  updateProjectSettingsPayload,
} from "@/lib/server/project-service"

const tempRoots: string[] = []

function makeReport(input: {
  projectName: string
  repos: Array<{ id: string; name: string; root: string; role: string }>
  health?: number
  issues?: Report["issues"]
  nodes?: Report["nodes"]
  edges?: Report["edges"]
  hotspots?: NonNullable<Report["insights"]>["hotspots"]
}): Report {
  return {
    project: {
      name: input.projectName,
      root: input.repos.map((repo) => repo.root).join(path.delimiter),
      stack: ["next.js", "django"],
      repos: input.repos.map((repo) => ({
        id: repo.id,
        name: repo.name,
        root: repo.root,
        role: repo.role as ProjectRepoRole,
        stack: repo.role === "backend" ? ["django"] : ["next.js"],
      })),
    },
    summary: {
      files: input.repos.length,
      components: 1,
      models: 1,
      endpoints: 1,
    },
    nodes: input.nodes ?? [],
    edges: input.edges ?? [],
    issues: input.issues ?? [],
    scores: {
      health: input.health ?? 100,
      breakdown: {},
    },
    insights: {
      churn: [],
      coverage: [
        {
          file: "frontend/app.tsx",
          total: 10,
          covered: 8,
          pct: 80,
          source: "lcov",
        },
      ],
      hotspots: input.hotspots ?? [
        {
          nodeId: "Component:frontend/app.tsx#App",
          kind: "Component",
          name: "App",
          file: "frontend/app.tsx",
          churn: 1,
          authors: 1,
          complexity: 7,
          fanIn: 0,
          fanOut: 1,
          impact: 1,
          score: 4,
          coveragePct: 80,
        },
      ],
      secrets: [],
      explanations: [],
    },
  }
}

describe("project-service persistence", () => {
  beforeEach(async () => {
    const root = await mkdtemp(path.join(tmpdir(), "code-mri-desktop-test-"))
    tempRoots.push(root)
    process.env.CODE_MRI_DB_PATH = path.join(root, "code-mri.sqlite")
    resetProjectDatabaseForTests()
    gitStates.clear()
    analyzeProjectReposMock.mockReset()
    analyzeProjectReposMock.mockImplementation(async (input) => ({
      report: makeReport(input),
    }))
  })

  afterEach(async () => {
    resetProjectDatabaseForTests()
    delete process.env.CODE_MRI_DB_PATH
    delete process.env.CODE_MRI_APP_DATA_DIR
    delete process.env.CODE_MRI_REPORT_RETENTION
    await Promise.all(
      tempRoots.splice(0).map((root) =>
        rm(root, { recursive: true, force: true })
      )
    )
  })

  test("creates a project with multiple repos, scans it, and restores active state", async () => {
    const frontendRoot = path.join(tempRoots[0], "frontend")
    const backendRoot = path.join(tempRoots[0], "backend")
    gitStates.set(frontendRoot, { gitHead: "front-1", gitDirty: false })
    gitStates.set(backendRoot, { gitHead: "back-1", gitDirty: false })

    const created = await createAndScanProjectPayload({
      name: "Acme",
      repos: [
        { name: "Frontend", root: frontendRoot, role: "frontend" },
        { name: "Backend", root: backendRoot, role: "backend" },
      ],
    })

    expect(created.projects).toHaveLength(1)
    expect(created.activeReport?.project.name).toBe("Acme")
    expect(created.projects[0]).toMatchObject({
      name: "Acme",
      repoCount: 2,
      latestScanId: expect.any(String),
      needsRefresh: false,
    })
    expect(
      created.projects[0]?.repos.map((repo) => repo.gitHead).sort()
    ).toEqual(["back-1", "front-1"])

    const restored = await projectsPayload()
    expect(restored.activeProjectId).toBe(created.activeProjectId)
    expect(restored.activeReport?.project.name).toBe("Acme")
  })

  test("passes a per-project incremental cache dir to the engine runner", async () => {
    const appData = path.join(tempRoots[0], "appdata")
    process.env.CODE_MRI_APP_DATA_DIR = appData
    const frontendRoot = path.join(tempRoots[0], "frontend")
    gitStates.set(frontendRoot, { gitHead: "front-1", gitDirty: false })

    const created = await createAndScanProjectPayload({
      name: "Acme",
      repos: [{ name: "Frontend", root: frontendRoot, role: "frontend" }],
    })
    const projectId = created.activeProjectId as string

    const callInput = analyzeProjectReposMock.mock.calls.at(-1)?.[0] as
      | { cacheDir?: string }
      | undefined
    expect(callInput?.cacheDir).toBe(path.join(appData, "cache", projectId))
  })

  test("detects stale repo head and dirty changes from stored scan snapshots", async () => {
    const frontendRoot = path.join(tempRoots[0], "frontend")
    const backendRoot = path.join(tempRoots[0], "backend")
    gitStates.set(frontendRoot, { gitHead: "front-1", gitDirty: false })
    gitStates.set(backendRoot, { gitHead: "back-1", gitDirty: false })

    await createAndScanProjectPayload({
      name: "Acme",
      repos: [
        { name: "Frontend", root: frontendRoot, role: "frontend" },
        { name: "Backend", root: backendRoot, role: "backend" },
      ],
    })

    gitStates.set(frontendRoot, { gitHead: "front-2", gitDirty: true })
    const payload = await projectsPayload()
    const project = payload.projects[0]

    expect(project?.needsRefresh).toBe(true)
    expect(project?.staleRepos).toEqual([
      expect.objectContaining({
        name: "Frontend",
        previousGitHead: "front-1",
        currentGitHead: "front-2",
        previousGitDirty: false,
        currentGitDirty: true,
        reasons: ["head", "dirty"],
      }),
    ])
  })

  test("persists project settings and repo edits", async () => {
    const frontendRoot = path.join(tempRoots[0], "frontend")
    const backendRoot = path.join(tempRoots[0], "backend")
    gitStates.set(frontendRoot, { gitHead: "front-1", gitDirty: false })
    gitStates.set(backendRoot, { gitHead: "back-1", gitDirty: false })

    const created = await createAndScanProjectPayload({
      name: "Acme",
      repos: [{ name: "Frontend", root: frontendRoot, role: "frontend" }],
    })
    const projectId = created.activeProjectId as string

    await updateProjectSettingsPayload(projectId, {
      autoScanOnChange: true,
    })
    const updated = await updateProjectPayload(projectId, {
      name: "Acme Platform",
      repos: [
        {
          id: "frontend",
          name: "Web",
          root: frontendRoot,
          role: "frontend",
        },
        {
          name: "Backend",
          root: backendRoot,
          role: "backend",
        },
      ],
    })

    expect(updated.projects[0]).toMatchObject({
      name: "Acme Platform",
      autoScanOnChange: true,
      repoCount: 2,
    })
    expect(updated.projects[0]?.repos.map((repo) => repo.name).sort()).toEqual([
      "Backend",
      "Web",
    ])

    const restored = await projectsPayload()
    expect(restored.projects[0]?.autoScanOnChange).toBe(true)
    expect(restored.projects[0]?.repos).toHaveLength(2)
  })

  test("keeps the previous successful report when refresh fails", async () => {
    const frontendRoot = path.join(tempRoots[0], "frontend")
    gitStates.set(frontendRoot, { gitHead: "front-1", gitDirty: false })

    const created = await createAndScanProjectPayload({
      name: "Acme",
      repos: [{ name: "Frontend", root: frontendRoot, role: "frontend" }],
    })
    const projectId = created.activeProjectId as string
    const previousScanId = created.projects[0]?.latestScanId

    gitStates.set(frontendRoot, { gitHead: "front-2", gitDirty: false })
    analyzeProjectReposMock.mockRejectedValueOnce(new Error("scan failed"))

    const failed = await scanProjectPayload(projectId)

    expect(failed.scanError).toBe("scan failed")
    expect(failed.activeReport?.project.name).toBe("Acme")
    expect(failed.projects[0]).toMatchObject({
      status: "error",
      error: "scan failed",
      latestScanId: previousScanId,
      needsRefresh: true,
    })
  })

  test("includes a diff between the active report and previous successful scan", async () => {
    const frontendRoot = path.join(tempRoots[0], "frontend")
    gitStates.set(frontendRoot, { gitHead: "front-1", gitDirty: false })

    const created = await createAndScanProjectPayload({
      name: "Acme",
      repos: [{ name: "Frontend", root: frontendRoot, role: "frontend" }],
    })
    const projectId = created.activeProjectId as string
    expect(created.activeReportDiff).toBeNull()

    analyzeProjectReposMock.mockImplementationOnce(async (input) => {
      const report = makeReport(input)
      return {
        report: {
          ...report,
          scores: {
            ...report.scores,
            health: 92,
          },
          nodes: [
            {
              id: "Component:frontend/Button.tsx#Button",
              kind: "Component",
              name: "Button",
              loc: { file: "frontend/Button.tsx" },
            },
          ],
        } satisfies Report,
      }
    })

    gitStates.set(frontendRoot, { gitHead: "front-2", gitDirty: false })
    const scanned = await scanProjectPayload(projectId)

    expect(scanned.activeReportDiff).toMatchObject({
      beforeScanId: created.projects[0]?.latestScanId,
      afterScanId: scanned.projects[0]?.latestScanId,
      diff: {
        summary: expect.objectContaining({
          healthDelta: -8,
          nodesAdded: 1,
        }),
      },
    })
  })

  test("persists scan metric snapshots and returns trend deltas", async () => {
    const frontendRoot = path.join(tempRoots[0], "frontend")
    gitStates.set(frontendRoot, { gitHead: "front-1", gitDirty: false })
    analyzeProjectReposMock.mockImplementationOnce(async (input) => ({
      report: makeReport({ ...input, health: 96 }),
    }))

    const created = await createAndScanProjectPayload({
      name: "Acme",
      repos: [{ name: "Frontend", root: frontendRoot, role: "frontend" }],
    })
    const projectId = created.activeProjectId as string

    expect(created.activeTrend).toMatchObject({
      snapshots: [
        expect.objectContaining({
          health: 96,
          issueCount: 0,
          coveragePct: 80,
          hotspotCount: 1,
          complexityTotal: 7,
        }),
      ],
      healthDelta: null,
      issueDelta: null,
    })

    gitStates.set(frontendRoot, { gitHead: "front-2", gitDirty: false })
    analyzeProjectReposMock.mockImplementationOnce(async (input) => ({
      report: makeReport({
        ...input,
        health: 90,
        nodes: [
          {
            id: "Component:frontend/app.tsx#App",
            kind: "Component",
            name: "App",
            loc: { file: "frontend/app.tsx" },
          },
        ],
        issues: [
          {
            kind: "DEAD_CODE",
            severity: "low",
            message: "Unused",
            nodes: ["Component:unused"],
          },
          {
            kind: "CIRCULAR_DEPENDENCY",
            severity: "medium",
            message: "Cycle",
            nodes: ["File:a", "File:b"],
          },
        ],
      }),
    }))

    const scanned = await scanProjectPayload(projectId)

    expect(scanned.activeTrend).toMatchObject({
      snapshots: [
        expect.objectContaining({ health: 96, issueCount: 0 }),
        expect.objectContaining({
          health: 90,
          issueCount: 2,
          deadCodeCount: 1,
          circularCount: 1,
        }),
      ],
      healthDelta: -6,
      issueDelta: 2,
    })
    expect(scanned.activeTrend?.repoActivity).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          repoId: "frontend",
          totalChanges: 3,
          cells: [
            expect.objectContaining({ count: 0, intensity: 0 }),
            expect.objectContaining({ count: 3, intensity: 4 }),
          ],
        }),
      ]),
    )
    expect(scanned.activeRegressionAlerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "HEALTH_DROP",
          current: 90,
          previous: 96,
          delta: -6,
        }),
        expect.objectContaining({
          kind: "NEW_CIRCULAR_DEPENDENCY",
          current: 1,
          previous: 0,
          delta: 1,
        }),
      ]),
    )
  })

  test("tracks architecture erosion as circular and cross-boundary edge series", async () => {
    const frontendRoot = path.join(tempRoots[0], "frontend")
    const backendRoot = path.join(tempRoots[0], "backend")
    gitStates.set(frontendRoot, { gitHead: "front-1", gitDirty: false })
    gitStates.set(backendRoot, { gitHead: "back-1", gitDirty: false })

    const crossNodes: Report["nodes"] = [
      {
        id: "Component:frontend/app.tsx#App",
        kind: "Component",
        name: "App",
        loc: { file: "frontend/app.tsx" },
      },
      {
        id: "Model:backend/models.py#User",
        kind: "Model",
        name: "User",
        loc: { file: "backend/models.py" },
      },
    ]

    const created = await createAndScanProjectPayload({
      name: "Acme",
      repos: [
        { name: "Frontend", root: frontendRoot, role: "frontend" },
        { name: "Backend", root: backendRoot, role: "backend" },
      ],
    })
    const projectId = created.activeProjectId as string

    expect(created.activeTrend?.erosion).toEqual([
      expect.objectContaining({
        circularCount: 0,
        crossBoundaryEdges: 0,
      }),
    ])

    gitStates.set(frontendRoot, { gitHead: "front-2", gitDirty: false })
    analyzeProjectReposMock.mockImplementationOnce(async (input) => ({
      report: makeReport({
        ...input,
        nodes: crossNodes,
        edges: [
          {
            from: "Component:frontend/app.tsx#App",
            to: "Model:backend/models.py#User",
            kind: "USES",
          },
        ],
        issues: [
          {
            kind: "CIRCULAR_DEPENDENCY",
            severity: "medium",
            message: "Cycle",
            nodes: ["File:a", "File:b"],
          },
        ],
      }),
    }))

    const scanned = await scanProjectPayload(projectId)

    expect(scanned.activeTrend?.erosion).toEqual([
      expect.objectContaining({ circularCount: 0, crossBoundaryEdges: 0 }),
      expect.objectContaining({ circularCount: 1, crossBoundaryEdges: 1 }),
    ])
    expect(scanned.activeTrend?.erosion?.at(-1)).toMatchObject({
      scanId: scanned.projects[0]?.latestScanId,
    })
  })

  test("builds node-level history for the latest hotspots across snapshots", async () => {
    const frontendRoot = path.join(tempRoots[0], "frontend")
    gitStates.set(frontendRoot, { gitHead: "front-1", gitDirty: false })

    const created = await createAndScanProjectPayload({
      name: "Acme",
      repos: [{ name: "Frontend", root: frontendRoot, role: "frontend" }],
    })
    const projectId = created.activeProjectId as string

    gitStates.set(frontendRoot, { gitHead: "front-2", gitDirty: false })
    analyzeProjectReposMock.mockImplementationOnce(async (input) => ({
      report: makeReport({
        ...input,
        hotspots: [
          {
            nodeId: "Component:frontend/app.tsx#App",
            kind: "Component",
            name: "App",
            file: "frontend/app.tsx",
            churn: 3,
            authors: 2,
            complexity: 9,
            fanIn: 0,
            fanOut: 1,
            impact: 1,
            score: 6,
            coveragePct: 75,
          },
        ],
      }),
    }))

    const scanned = await scanProjectPayload(projectId)

    expect(scanned.activeTrend?.nodeHistory).toEqual([
      expect.objectContaining({
        nodeId: "Component:frontend/app.tsx#App",
        file: "frontend/app.tsx",
        points: [
          expect.objectContaining({ churn: 1, complexity: 7, coveragePct: 80 }),
          expect.objectContaining({ churn: 3, complexity: 9, coveragePct: 75 }),
        ],
      }),
    ])
  })

  test("prunes old raw reports beyond the retention limit while keeping metrics", async () => {
    process.env.CODE_MRI_REPORT_RETENTION = "2"
    const frontendRoot = path.join(tempRoots[0], "frontend")
    gitStates.set(frontendRoot, { gitHead: "front-1", gitDirty: false })

    const created = await createAndScanProjectPayload({
      name: "Acme",
      repos: [{ name: "Frontend", root: frontendRoot, role: "frontend" }],
    })
    const projectId = created.activeProjectId as string

    gitStates.set(frontendRoot, { gitHead: "front-2", gitDirty: false })
    await scanProjectPayload(projectId)
    gitStates.set(frontendRoot, { gitHead: "front-3", gitDirty: false })
    const third = await scanProjectPayload(projectId)

    expect(listProjectMetricSnapshots(projectId, 12)).toHaveLength(3)
    expect(listProjectReportSnapshots(projectId, 12)).toHaveLength(2)
    expect(third.activeReport?.project.name).toBe("Acme")
    expect(third.activeReportDiff).not.toBeNull()
  })

  test("switches the active project report", async () => {
    const firstRoot = path.join(tempRoots[0], "first")
    const secondRoot = path.join(tempRoots[0], "second")
    gitStates.set(firstRoot, { gitHead: "first-1", gitDirty: false })
    gitStates.set(secondRoot, { gitHead: "second-1", gitDirty: false })

    const first = await createAndScanProjectPayload({
      name: "First",
      repos: [{ name: "First repo", root: firstRoot, role: "frontend" }],
    })
    const firstId = first.activeProjectId as string
    const second = await createAndScanProjectPayload({
      name: "Second",
      repos: [{ name: "Second repo", root: secondRoot, role: "backend" }],
    })

    expect(second.activeReport?.project.name).toBe("Second")

    const switched = await selectProjectPayload(firstId)
    expect(switched.activeProjectId).toBe(firstId)
    expect(switched.activeReport?.project.name).toBe("First")
  })

  test("uses app data directory when a packaged runtime provides it", () => {
    delete process.env.CODE_MRI_DB_PATH
    const appDataDir = path.join(tempRoots[0], "app-data")
    process.env.CODE_MRI_APP_DATA_DIR = appDataDir

    expect(resolveProjectDatabasePath()).toBe(
      path.join(appDataDir, "code-mri.sqlite")
    )
  })

  test("keeps explicit database path as the strongest override", () => {
    const explicitPath = path.join(tempRoots[0], "explicit.sqlite")
    process.env.CODE_MRI_DB_PATH = explicitPath
    process.env.CODE_MRI_APP_DATA_DIR = path.join(tempRoots[0], "app-data")

    expect(resolveProjectDatabasePath()).toBe(explicitPath)
  })
})
