import type { NodeKind, ProjectRepoInfo, Report } from "@code-mri/shared-types"
import {
  ContributionGraph,
  type ContributionData,
} from "@/components/smoothui/contribution-graph"
import { StackLogoItem } from "@/components/stack-logo"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type {
  ProjectSummary,
  RepoContributionSeries,
  ProjectTrendPayload,
  RegressionAlertPayload,
} from "@/lib/report"

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  )
}

function healthTone(health: number): string {
  if (health >= 85) return "text-foreground"
  if (health >= 60) return "text-muted-foreground"
  return "text-destructive"
}

function shortHead(head: string | null): string {
  return head ? head.slice(0, 7) : "unknown"
}

function repoStatus(
  repo: ProjectSummary["repos"][number],
  project: ProjectSummary | null
) {
  const stale = project?.staleRepos.find((item) => item.id === repo.id)
  if (stale) {
    return {
      label: stale.reasons.includes("head") ? "Head changed" : "Dirty",
      variant: "secondary" as const,
    }
  }
  if (repo.gitDirty) {
    return { label: "Dirty", variant: "secondary" as const }
  }
  return { label: "Current", variant: "outline" as const }
}

function nodeKindCounts(report: Report): Array<[NodeKind, number]> {
  return Object.entries(
    report.nodes.reduce<Record<string, number>>((acc, node) => {
      acc[node.kind] = (acc[node.kind] ?? 0) + 1
      return acc
    }, {})
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10) as Array<[NodeKind, number]>
}

function reportRepoCards(projectRepos: ProjectRepoInfo[] | undefined) {
  return (projectRepos ?? []).map((repo) => ({
    id: repo.id,
    name: repo.name,
    role: repo.role,
    root: repo.root,
    stack: repo.stack,
    gitHead: null,
    gitDirty: false,
  }))
}

function deltaText(value: number | null): string {
  if (value === null) return "n/a"
  return value > 0 ? `+${value}` : String(value)
}

function deltaTone(value: number | null, lowerIsBetter = false) {
  if (value === null || value === 0) return "outline" as const
  const good = lowerIsBetter ? value < 0 : value > 0
  return good ? ("default" as const) : ("destructive" as const)
}

function contributionDate(value: string | null): string | null {
  return value?.slice(0, 10) ?? null
}

function contributionLevel(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0
  const ratio = count / max
  if (ratio <= 0.25) return 1
  if (ratio <= 0.5) return 2
  if (ratio <= 0.75) return 3
  return 4
}

function contributionDataForRepo(
  repo: RepoContributionSeries
): ContributionData[] {
  const byDate = new Map<string, number>()

  for (const cell of repo.cells) {
    const date = contributionDate(cell.date)
    if (!date) continue
    byDate.set(date, (byDate.get(date) ?? 0) + cell.count)
  }

  const max = Math.max(0, ...byDate.values())

  return [...byDate.entries()].map(([date, count]) => ({
    date,
    count,
    level: contributionLevel(count, max),
  }))
}

function contributionYear(repo: RepoContributionSeries): number {
  for (const cell of repo.cells) {
    const date = contributionDate(cell.date)
    if (date) return Number(date.slice(0, 4))
  }
  return new Date().getFullYear()
}

function RepoContributionGraph({
  activity,
}: {
  activity: RepoContributionSeries | null
}) {
  if (!activity) {
    return (
      <p className="text-sm text-muted-foreground">
        No repo-specific scan activity yet.
      </p>
    )
  }

  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">
          Activity trend
        </span>
        <Badge variant="secondary">{activity.totalChanges} changes</Badge>
      </div>
      <ContributionGraph
        data={contributionDataForRepo(activity)}
        year={contributionYear(activity)}
      />
    </div>
  )
}

function TrendPanel({
  alerts,
  activeProject,
  repos,
  trend,
}: {
  alerts: RegressionAlertPayload[]
  activeProject: ProjectSummary | null
  repos: ProjectSummary["repos"]
  trend: ProjectTrendPayload | null
}) {
  const snapshots = trend?.snapshots ?? []
  const maxHealth = Math.max(100, ...snapshots.map((item) => item.health))
  const latest = trend?.latest ?? null
  const erosion = trend?.erosion ?? []
  const latestErosion = erosion.at(-1) ?? null
  const previousErosion = erosion.at(-2) ?? null
  const circularDelta =
    latestErosion && previousErosion
      ? latestErosion.circularCount - previousErosion.circularCount
      : null
  const crossBoundaryDelta =
    latestErosion && previousErosion
      ? latestErosion.crossBoundaryEdges - previousErosion.crossBoundaryEdges
      : null
  const maxErosion = Math.max(
    1,
    ...erosion.map((point) => point.circularCount + point.crossBoundaryEdges)
  )
  const repoActivityById = new Map(
    (trend?.repoActivity ?? []).map((activity) => [activity.repoId, activity])
  )

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Trend</CardTitle>
          <Badge variant={snapshots.length > 1 ? "secondary" : "outline"}>
            {snapshots.length} scans
          </Badge>
        </div>
        <CardDescription>
          Health, issue, coverage, and hotspot metrics from successful scans
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {alerts.length ? (
          <div className="flex flex-col gap-2">
            {alerts.map((alert) => (
              <div
                key={alert.kind}
                className="rounded-lg border border-destructive/30 bg-destructive/10 p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="destructive">{alert.kind}</Badge>
                  <Badge variant="outline">{alert.severity}</Badge>
                </div>
                <p className="mt-2 text-sm">{alert.message}</p>
                <div className="mt-2 font-mono text-xs text-muted-foreground">
                  {alert.previous ?? "n/a"} -&gt; {alert.current}
                  {alert.delta === null ? "" : ` (${deltaText(alert.delta)})`}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {snapshots.length ? (
          <div className="flex h-24 items-end gap-1">
            {snapshots.map((snapshot) => (
              <div
                key={snapshot.scanId}
                className="flex min-w-0 flex-1 flex-col items-center gap-1"
                title={`${snapshot.health}/100 - ${snapshot.issueCount} issues`}
              >
                <div
                  className="w-full rounded-sm bg-primary/70"
                  style={{
                    height: `${Math.max(8, (snapshot.health / maxHealth) * 80)}px`,
                  }}
                />
                <span className="font-mono text-[10px] text-muted-foreground">
                  {snapshot.health}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No persisted scan metrics yet.
          </p>
        )}

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <div className="text-xs text-muted-foreground">Health delta</div>
            <Badge className="mt-2" variant={deltaTone(trend?.healthDelta ?? null)}>
              {deltaText(trend?.healthDelta ?? null)}
            </Badge>
          </div>
          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <div className="text-xs text-muted-foreground">Issue delta</div>
            <Badge
              className="mt-2"
              variant={deltaTone(trend?.issueDelta ?? null, true)}
            >
              {deltaText(trend?.issueDelta ?? null)}
            </Badge>
          </div>
          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <div className="text-xs text-muted-foreground">Coverage</div>
            <div className="mt-2 font-mono text-sm">
              {latest?.coveragePct === null || latest?.coveragePct === undefined
                ? "n/a"
                : `${latest.coveragePct}%`}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <div className="text-xs text-muted-foreground">Hotspots</div>
            <div className="mt-2 font-mono text-sm">
              {latest?.hotspotCount ?? 0}
            </div>
          </div>
        </div>

        <div className="border-t border-border pt-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-medium">Architecture erosion</h3>
              <p className="text-xs text-muted-foreground">
                Circular dependencies and cross-boundary edges per successful
                scan
              </p>
            </div>
          </div>

          {erosion.length ? (
            <div className="grid gap-3 lg:grid-cols-3">
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <div className="text-xs text-muted-foreground">
                  Circular dependencies
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="font-mono text-sm">
                    {latestErosion?.circularCount ?? 0}
                  </span>
                  <Badge variant={deltaTone(circularDelta, true)}>
                    {deltaText(circularDelta)}
                  </Badge>
                </div>
              </div>
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <div className="text-xs text-muted-foreground">
                  Cross-boundary edges
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="font-mono text-sm">
                    {latestErosion?.crossBoundaryEdges ?? 0}
                  </span>
                  <Badge variant={deltaTone(crossBoundaryDelta, true)}>
                    {deltaText(crossBoundaryDelta)}
                  </Badge>
                </div>
              </div>
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <div className="text-xs text-muted-foreground">
                  Erosion over time
                </div>
                <div className="mt-2 flex h-10 items-end gap-1">
                  {erosion.map((point) => (
                    <div
                      key={point.scanId}
                      className="flex min-w-0 flex-1 flex-col justify-end gap-px"
                      title={`${point.circularCount} circular - ${point.crossBoundaryEdges} cross-boundary`}
                    >
                      <div
                        className="w-full rounded-sm bg-destructive/60"
                        style={{
                          height: `${(point.circularCount / maxErosion) * 36}px`,
                        }}
                      />
                      <div
                        className="w-full rounded-sm bg-primary/50"
                        style={{
                          height: `${(point.crossBoundaryEdges / maxErosion) * 36}px`,
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No erosion history yet — run more scans to build the series.
            </p>
          )}
        </div>

        <div className="border-t border-border pt-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-medium">Repositories</h3>
              <p className="text-xs text-muted-foreground">
                {repos.length} repo{repos.length === 1 ? "" : "s"} scanned as one
                project with per-repo scan activity
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {activeProject?.latestScanId ? (
                <Badge variant="secondary">incremental cache</Badge>
              ) : null}
              <Badge variant="outline">contribution graph</Badge>
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            {repos.map((repo) => {
              const status = activeProject
                ? repoStatus(repo, activeProject)
                : null
              const activity = repoActivityById.get(repo.id) ?? null

              return (
                <div
                  key={repo.id}
                  className="min-w-0 rounded-lg border border-border bg-muted/20 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{repo.name}</div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <Badge variant="outline">{repo.role}</Badge>
                        {status ? (
                          <Badge variant={status.variant}>{status.label}</Badge>
                        ) : null}
                      </div>
                    </div>
                    <span className="font-mono text-xs text-muted-foreground">
                      {shortHead(repo.gitHead)}
                    </span>
                  </div>

                  <div className="mt-3 truncate font-mono text-xs text-muted-foreground">
                    {repo.root}
                  </div>

                  {repo.stack.length ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {repo.stack.map((stack) => (
                        <Badge key={stack} variant="secondary">
                          {stack}
                        </Badge>
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-4 border-t border-border pt-3">
                    <RepoContributionGraph activity={activity} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function Overview({
  activeProject,
  activeRegressionAlerts,
  activeTrend,
  report,
}: {
  activeProject: ProjectSummary | null
  activeRegressionAlerts: RegressionAlertPayload[]
  activeTrend: ProjectTrendPayload | null
  report: Report
}) {
  const { project, summary, scores, issues } = report
  const repos = activeProject?.repos.length
    ? activeProject.repos
    : reportRepoCards(project.repos)
  const kinds = nodeKindCounts(report)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">{project.name}</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {project.stack.map((stack) => (
            <StackLogoItem key={stack} name={stack} />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Files" value={summary.files} />
        <Stat label="Components" value={summary.components} />
        <Stat label="Models" value={summary.models} />
        <Stat label="Endpoints" value={summary.endpoints} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Architecture Health</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-5xl font-bold tabular-nums ${healthTone(scores.health)}`}
            >
              {scores.health}
              <span className="text-xl text-muted-foreground">/100</span>
            </div>
            <div className="mt-4 flex flex-col gap-1 text-sm">
              {Object.entries(scores.breakdown).length === 0 && (
                <p className="text-muted-foreground">No penalties — clean.</p>
              )}
              {Object.entries(scores.breakdown).map(([kind, points]) => (
                <div key={kind} className="flex justify-between">
                  <span className="text-muted-foreground">{kind}</span>
                  <span className="font-medium text-destructive">
                    -{points}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Issues ({issues.length})</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            {issues.length === 0 && (
              <p className="text-muted-foreground">None found.</p>
            )}
            {Object.entries(
              issues.reduce<Record<string, number>>((acc, i) => {
                acc[i.kind] = (acc[i.kind] ?? 0) + 1
                return acc
              }, {})
            ).map(([kind, count]) => (
              <div key={kind} className="flex justify-between">
                <span className="text-muted-foreground">{kind}</span>
                <span className="font-medium tabular-nums">{count}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <TrendPanel
        activeProject={activeProject}
        alerts={activeRegressionAlerts}
        repos={repos}
        trend={activeTrend}
      />

      <Card>
        <CardHeader>
          <CardTitle>Engine Coverage</CardTitle>
          <CardDescription>
            Top graph node kinds emitted by the current scan
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {kinds.map(([kind, count]) => (
            <div
              key={kind}
              className="flex items-center justify-between gap-4"
            >
              <span className="text-muted-foreground">{kind}</span>
              <span className="font-medium tabular-nums">{count}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
