import type {
  AiExplanation,
  CoverageMetric,
  GitChurnMetric,
  HotspotMetric,
  Issue,
  Report,
  SecretFinding,
} from "@code-mri/engine"
import { Badge } from "@/components/ui/badge"
import type { NodeHistorySeries } from "@/lib/report"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

function pctLabel(value: number | null | undefined): string {
  return typeof value === "number" ? `${value}%` : "unknown"
}

function scoreTone(score: number): "default" | "secondary" | "outline" {
  if (score >= 70) return "default"
  if (score >= 25) return "secondary"
  return "outline"
}

function shortDate(value: string | undefined): string {
  if (!value) return "unknown"
  return value.slice(0, 10)
}

function ChurnTable({ churn }: { churn: GitChurnMetric[] }) {
  if (churn.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No git churn data was available for the scanned files.
      </p>
    )
  }

  return (
    <div className="rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>File</TableHead>
            <TableHead>Commits</TableHead>
            <TableHead>Authors</TableHead>
            <TableHead>Last touched</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {churn.slice(0, 12).map((item) => (
            <TableRow key={item.file}>
              <TableCell className="max-w-80 truncate font-mono text-xs">
                {item.file}
              </TableCell>
              <TableCell className="font-mono text-xs">{item.commits}</TableCell>
              <TableCell className="font-mono text-xs">{item.authors}</TableCell>
              <TableCell className="font-mono text-xs">
                {shortDate(item.lastCommitAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function NodeHistorySparkline({ series }: { series: NodeHistorySeries | null }) {
  if (!series || series.points.length < 2) {
    return <span className="font-mono text-xs text-muted-foreground">n/a</span>
  }

  const max = Math.max(1, ...series.points.map((point) => point.complexity ?? 0))

  return (
    <div className="flex h-8 items-end gap-px">
      {series.points.map((point) => (
        <div
          key={point.scanId}
          className="w-1.5 rounded-sm bg-primary/60"
          style={{
            height: `${Math.max(3, ((point.complexity ?? 0) / max) * 30)}px`,
          }}
          title={`${shortDate(point.date ?? undefined)} · churn ${point.churn ?? "?"} · complexity ${point.complexity ?? "?"} · coverage ${pctLabel(point.coveragePct)}`}
        />
      ))}
    </div>
  )
}

function HotspotTable({
  hotspots,
  nodeHistory,
}: {
  hotspots: HotspotMetric[]
  nodeHistory: NodeHistorySeries[]
}) {
  const historyByNode = new Map(
    nodeHistory.flatMap((series) => {
      const keys: Array<[string, NodeHistorySeries]> = [[series.nodeId, series]]
      if (series.file) keys.push([series.file, series])
      return keys
    })
  )
  const historyFor = (hotspot: HotspotMetric): NodeHistorySeries | null =>
    historyByNode.get(hotspot.nodeId) ??
    (hotspot.file ? historyByNode.get(hotspot.file) : null) ??
    null

  if (hotspots.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No hotspot candidates from the available git churn and complexity
        signals.
      </p>
    )
  }

  return (
    <div className="rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Node</TableHead>
            <TableHead>Score</TableHead>
            <TableHead>Complexity</TableHead>
            <TableHead>Churn</TableHead>
            <TableHead>Coverage</TableHead>
            <TableHead>Fan</TableHead>
            <TableHead>Impact</TableHead>
            <TableHead>History</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {hotspots.slice(0, 12).map((hotspot) => (
            <TableRow key={hotspot.nodeId}>
              <TableCell>
                <div className="min-w-0">
                  <div className="truncate font-medium">{hotspot.name}</div>
                  <div className="truncate font-mono text-xs text-muted-foreground">
                    {hotspot.file ?? hotspot.nodeId}
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <Badge variant={scoreTone(hotspot.score)}>{hotspot.score}</Badge>
              </TableCell>
              <TableCell className="font-mono text-xs">{hotspot.complexity}</TableCell>
              <TableCell className="font-mono text-xs">
                {hotspot.churn} commits · {hotspot.authors} authors
              </TableCell>
              <TableCell className="font-mono text-xs">
                {pctLabel(hotspot.coveragePct)}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {hotspot.fanIn} in · {hotspot.fanOut} out
              </TableCell>
              <TableCell className="font-mono text-xs">{hotspot.impact}</TableCell>
              <TableCell>
                <NodeHistorySparkline series={historyFor(hotspot)} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function CoverageTable({ coverage }: { coverage: CoverageMetric[] }) {
  if (coverage.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No local coverage report was found or provided.
      </p>
    )
  }

  return (
    <div className="rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>File</TableHead>
            <TableHead>Covered</TableHead>
            <TableHead>Source</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {coverage.slice(0, 12).map((item) => (
            <TableRow key={item.file}>
              <TableCell className="max-w-80 truncate font-mono text-xs">
                {item.file}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {pctLabel(item.pct)} · {item.covered}/{item.total}
              </TableCell>
              <TableCell>
                <Badge variant="outline">{item.source}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function SecurityList({ secrets }: { secrets: SecretFinding[] }) {
  if (secrets.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No committed secret candidates detected by local regex and entropy
        rules.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {secrets.map((secret) => (
        <div
          key={`${secret.file}:${secret.line}:${secret.column}:${secret.rule}`}
          className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/20 p-3"
        >
          <div className="min-w-0">
            <div className="truncate font-mono text-xs">
              {secret.file}:{secret.line}:{secret.column}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {secret.rule} · {secret.preview}
              {typeof secret.entropy === "number"
                ? ` · entropy ${secret.entropy}`
                : ""}
            </div>
          </div>
          <Badge variant="destructive">review</Badge>
        </div>
      ))}
    </div>
  )
}

function ExplanationList({ explanations }: { explanations: AiExplanation[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {explanations.map((explanation) => (
        <div
          key={explanation.id}
          className="rounded-lg border border-border bg-muted/20 p-3"
        >
          <div className="font-medium">{explanation.title}</div>
          <div className="mt-2 flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              {explanation.summary}
            </p>
            {explanation.evidence.length ? (
              <div className="flex flex-wrap gap-1.5">
                {explanation.evidence.map((evidence, index) => (
                  <Badge key={`${explanation.id}-${index}`} variant="outline">
                    {evidence.label}
                  </Badge>
                ))}
              </div>
            ) : null}
            {explanation.evidence.some(
              (evidence) => evidence.file || evidence.nodeId || evidence.issueKind
            ) ? (
              <div className="flex flex-col gap-1 font-mono text-[11px] text-muted-foreground">
                {explanation.evidence.map((evidence, index) => (
                  <span key={`${explanation.id}-source-${index}`} className="truncate">
                    {evidence.file ?? evidence.nodeId ?? evidence.issueKind}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}

function Phase10Issues({ issues }: { issues: Issue[] }) {
  const phaseIssues = issues.filter(
    (issue) =>
      issue.kind === "SECRET_CANDIDATE" ||
      issue.kind === "UNCOVERED_RISKY_NODE" ||
      issue.kind === "COMPLEXITY_HOTSPOT"
  )

  if (phaseIssues.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No Phase 10 risk issues were emitted for this report.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {phaseIssues.slice(0, 12).map((issue, index) => (
        <div
          key={`${issue.kind}-${index}`}
          className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/20 p-3"
        >
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{issue.message}</div>
            <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
              {issue.nodes.join(", ")}
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Badge variant="outline">{issue.kind}</Badge>
            <Badge variant={issue.severity === "high" ? "destructive" : "secondary"}>
              {issue.severity}
            </Badge>
          </div>
        </div>
      ))}
    </div>
  )
}

export function Insights({
  report,
  nodeHistory = [],
}: {
  report: Report
  nodeHistory?: NodeHistorySeries[]
}) {
  const insights = report.insights
  const churn = insights?.churn ?? []
  const coverage = insights?.coverage ?? []
  const coverageAvg =
    coverage.length > 0
      ? Math.round(
          coverage.reduce((sum, item) => sum + (item.pct ?? 0), 0) /
            coverage.length
        )
      : null

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle>Hotspots</CardTitle>
          <CardDescription>
            Churn × complexity, with fan-in/fan-out and impact context.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <HotspotTable
            hotspots={insights?.hotspots ?? []}
            nodeHistory={nodeHistory}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Git Churn</CardTitle>
          <CardDescription>
            File change frequency and author count from local git history.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChurnTable churn={churn} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Coverage</CardTitle>
          <CardDescription>
            lcov.info or Istanbul JSON mapped back to graph files.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {coverageAvg !== null ? (
            <Progress value={coverageAvg}>
              <ProgressLabel>Average mapped coverage</ProgressLabel>
              <ProgressValue>{() => `${coverageAvg}%`}</ProgressValue>
            </Progress>
          ) : null}
          <CoverageTable coverage={coverage} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Security</CardTitle>
          <CardDescription>Committed secret candidates, redacted.</CardDescription>
        </CardHeader>
        <CardContent>
          <SecurityList secrets={insights?.secrets ?? []} />
        </CardContent>
      </Card>

      <Card className="xl:col-span-3">
        <CardHeader>
          <CardTitle>Phase 10 Findings</CardTitle>
          <CardDescription>
            Score-affecting security, coverage, and complexity issues.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Phase10Issues issues={report.issues} />
        </CardContent>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle>Explanations</CardTitle>
          <CardDescription>
            Deterministic summaries with graph and issue evidence.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ExplanationList explanations={insights?.explanations ?? []} />
        </CardContent>
      </Card>

      <Card className="xl:col-span-3">
        <CardHeader>
          <CardTitle>Dependency Audit</CardTitle>
        </CardHeader>
        <CardContent>
          <Badge variant="outline">{insights?.dependencyAudit?.status ?? "not_run"}</Badge>
          <p className="mt-2 text-sm text-muted-foreground">
            {insights?.dependencyAudit?.reason ??
              "Dependency CVE lookup was not run for this report."}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
