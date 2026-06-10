import type { GraphNode, Issue, Report, Severity } from "@code-mri/shared-types"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress"

const SEVERITY_TONE: Record<Severity, string> = {
  high: "text-destructive",
  medium: "text-muted-foreground",
  low: "text-muted-foreground",
  info: "text-muted-foreground",
}

const SEVERITY_RANK: Record<Severity, number> = {
  high: 0,
  medium: 1,
  low: 2,
  info: 3,
}

function severityVariant(severity: Severity) {
  if (severity === "high") return "destructive"
  if (severity === "medium") return "secondary"
  return "outline"
}

function issueNodeLabels(issue: Issue, byId: Map<string, GraphNode>) {
  return issue.nodes.map((id) => {
    const node = byId.get(id)
    if (!node) return id
    const file = node.loc?.file ? ` · ${node.loc.file}` : ""
    return `${node.name}${file}`
  })
}

function metaSummary(issue: Issue) {
  const entries = Object.entries(issue.meta ?? {})
    .filter(([, value]) => {
      const type = typeof value
      return type === "string" || type === "number" || type === "boolean"
    })
    .slice(0, 6)

  return entries.map(([key, value]) => {
    const normalized = String(value)
    const shortened =
      normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized
    return `${key}: ${shortened}`
  })
}

function IssueDetails({
  issues,
  byId,
}: {
  issues: Issue[]
  byId: Map<string, GraphNode>
}) {
  if (issues.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No issue details were emitted by the engine.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {issues.map((issue, index) => {
        const labels = issueNodeLabels(issue, byId)
        const meta = metaSummary(issue)

        return (
          <div
            key={`${issue.kind}-${issue.message}-${index}`}
            className="rounded-lg border border-border bg-background p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{issue.kind}</Badge>
              <Badge variant={severityVariant(issue.severity)}>
                {issue.severity}
              </Badge>
              {issue.candidate ? (
                <Badge variant="secondary">candidate</Badge>
              ) : null}
            </div>
            <div className="mt-2 text-sm font-medium">{issue.message}</div>
            {labels.length ? (
              <div className="mt-2 flex flex-col gap-1">
                {labels.slice(0, 6).map((label) => (
                  <div
                    key={label}
                    className="truncate font-mono text-xs text-muted-foreground"
                    title={label}
                  >
                    {label}
                  </div>
                ))}
                {labels.length > 6 ? (
                  <div className="text-xs text-muted-foreground">
                    +{labels.length - 6} more nodes
                  </div>
                ) : null}
              </div>
            ) : null}
            {meta.length ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {meta.map((entry) => (
                  <span
                    key={entry}
                    className="rounded-md bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground"
                  >
                    {entry}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function BoundaryViolations({
  issues,
  byId,
}: {
  issues: Issue[]
  byId: Map<string, GraphNode>
}) {
  if (!issues.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No configured boundary violations.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {issues.map((issue, index) => {
        const from = byId.get(issue.nodes[0] ?? "")
        const to = byId.get(issue.nodes[1] ?? "")
        const meta = issue.meta as
          | {
              edgeKind?: unknown
              fromGroup?: unknown
              toGroup?: unknown
              fromFile?: unknown
              toFile?: unknown
              rule?: unknown
              allowedTo?: unknown
            }
          | undefined
        const fromLabel =
          typeof meta?.fromFile === "string" ? meta.fromFile : from?.name
        const toLabel =
          typeof meta?.toFile === "string" ? meta.toFile : to?.name
        const edgeKind =
          typeof meta?.edgeKind === "string" ? meta.edgeKind : "edge"
        const groupLabel =
          typeof meta?.fromGroup === "string" &&
          typeof meta?.toGroup === "string"
            ? `${meta.fromGroup} -> ${meta.toGroup}`
            : null

        return (
          <div
            key={`${issue.message}-${index}`}
            className="rounded-lg border border-border bg-background p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="destructive">BOUNDARY_VIOLATION</Badge>
              <Badge variant="outline">{edgeKind}</Badge>
              {groupLabel ? (
                <Badge variant="secondary">{groupLabel}</Badge>
              ) : null}
              {typeof meta?.rule === "string" ? (
                <Badge variant="outline">{meta.rule} rule</Badge>
              ) : null}
            </div>
            <div className="mt-2 font-mono text-xs text-muted-foreground">
              {fromLabel ?? issue.nodes[0]}{" -> "}
              {toLabel ?? issue.nodes[1]}
            </div>
            <div className="mt-2 text-sm">{issue.message}</div>
            {typeof meta?.allowedTo === "string" ? (
              <div className="mt-2 text-xs text-muted-foreground">
                Allowed targets: {meta.allowedTo}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

export function RiskDashboard({ report }: { report: Report }) {
  const { scores, issues } = report
  const byId = new Map(report.nodes.map((node) => [node.id, node]))
  const boundaryIssues = issues.filter(
    (issue) => issue.kind === "BOUNDARY_VIOLATION"
  )
  const bySeverity = issues.reduce<Record<string, number>>((acc, i) => {
    acc[i.severity] = (acc[i.severity] ?? 0) + 1
    return acc
  }, {})
  const sortedIssues = [...issues].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.kind.localeCompare(b.kind) ||
      a.message.localeCompare(b.message)
  )
  const scoredBreakdown = Object.entries(scores.breakdown).filter(
    ([, points]) => points > 0
  )
  const informationalBreakdown = Object.entries(scores.breakdown).filter(
    ([, points]) => points === 0
  )

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <Card className="md:col-span-1">
        <CardHeader>
          <CardTitle>Health Score</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-6xl font-bold tabular-nums">{scores.health}</div>
          <p className="mt-1 text-sm text-muted-foreground">
            out of 100 — fully explainable
          </p>
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>Score Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {scoredBreakdown.length === 0 && (
            <p className="text-muted-foreground">No deductions.</p>
          )}
          {scoredBreakdown.map(([kind, points]) => (
            <Progress key={kind} value={Math.min(100, points * 5)}>
              <ProgressLabel>{kind}</ProgressLabel>
              <ProgressValue>{() => `-${points}`}</ProgressValue>
            </Progress>
          ))}
          {informationalBreakdown.length ? (
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
              {informationalBreakdown.map(([kind]) => kind).join(", ")} flagged
              for review with no health penalty.
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="md:col-span-3">
        <CardHeader>
          <CardTitle>Issues by Severity</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-6">
          {(["high", "medium", "low", "info"] as Severity[]).map((sev) => (
            <div key={sev}>
              <div
                className={`text-3xl font-bold tabular-nums ${SEVERITY_TONE[sev]}`}
              >
                {bySeverity[sev] ?? 0}
              </div>
              <div className="text-xs text-muted-foreground uppercase">
                {sev}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="md:col-span-3">
        <CardHeader>
          <CardTitle>Boundary Violations</CardTitle>
        </CardHeader>
        <CardContent>
          <BoundaryViolations issues={boundaryIssues} byId={byId} />
        </CardContent>
      </Card>

      <Card className="md:col-span-3">
        <CardHeader>
          <CardTitle>Issue Details</CardTitle>
        </CardHeader>
        <CardContent>
          <IssueDetails issues={sortedIssues} byId={byId} />
        </CardContent>
      </Card>
    </div>
  )
}
