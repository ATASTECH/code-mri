import type { ReportChange, ReportDiff } from "@code-mri/shared-types"
import { GitCompareArrowsIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { ActiveReportDiffPayload } from "@/lib/report"

const CHANGE_LABELS: Record<ReportChange["kind"], string> = {
  node_added: "Node added",
  node_removed: "Node removed",
  node_changed: "Node changed",
  edge_added: "Edge added",
  edge_removed: "Edge removed",
  issue_added: "Issue added",
  issue_removed: "Issue removed",
}

function compactScanId(scanId: string): string {
  return scanId.replace(/^scan_/, "").slice(0, 8)
}

function shortDate(value: string | null): string {
  if (!value) return "unknown"
  return value.replace("T", " ").slice(0, 16)
}

function changeTone(kind: ReportChange["kind"]) {
  if (kind.endsWith("_removed")) return "destructive"
  if (kind.endsWith("_changed")) return "secondary"
  return "default"
}

function deltaLabel(value: number): string {
  if (value > 0) return `+${value}`
  return String(value)
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string
  value: number | string
  tone?: "default" | "secondary" | "destructive" | "outline"
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Badge variant={tone} className="h-7 rounded-md px-2.5 text-base">
          {value}
        </Badge>
      </CardContent>
    </Card>
  )
}

function healthTone(delta: number) {
  if (delta < 0) return "destructive"
  if (delta > 0) return "default"
  return "outline"
}

function changeGroups(diff: ReportDiff) {
  return Object.entries(
    diff.changes.reduce<Record<string, ReportChange[]>>((acc, change) => {
      acc[change.kind] = [...(acc[change.kind] ?? []), change]
      return acc
    }, {})
  ).sort(([a], [b]) => a.localeCompare(b)) as Array<
    [ReportChange["kind"], ReportChange[]]
  >
}

function ChangesTable({ changes }: { changes: ReportChange[] }) {
  if (!changes.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No graph, issue, or contract changes between these scans.
      </p>
    )
  }

  return (
    <div className="rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Kind</TableHead>
            <TableHead>Label</TableHead>
            <TableHead>ID</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {changes.slice(0, 80).map((change) => (
            <TableRow key={`${change.kind}:${change.id}`}>
              <TableCell>
                <Badge
                  variant={
                    changeTone(change.kind) as
                      | "default"
                      | "secondary"
                      | "destructive"
                      | "outline"
                  }
                >
                  {CHANGE_LABELS[change.kind]}
                </Badge>
              </TableCell>
              <TableCell className="max-w-xl truncate">
                {change.label}
              </TableCell>
              <TableCell className="max-w-md truncate font-mono text-xs text-muted-foreground">
                {change.id}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function EmptyDiff() {
  return (
    <Empty className="min-h-80 rounded-lg border border-border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <GitCompareArrowsIcon />
        </EmptyMedia>
        <EmptyTitle>No previous scan</EmptyTitle>
        <EmptyDescription>
          Run the project scan at least twice to compare the active report with
          the previous successful report.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

export function WhatChanged({
  payload,
}: {
  payload: ActiveReportDiffPayload | null
}) {
  if (!payload) return <EmptyDiff />

  const { diff } = payload
  const groups = changeGroups(diff)
  const totalChanges = diff.changes.length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 p-3">
        <div className="min-w-0">
          <div className="font-medium">
            {diff.beforeProject} -&gt; {diff.afterProject}
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="font-mono">
              {compactScanId(payload.beforeScanId)} /{" "}
              {shortDate(payload.beforeFinishedAt)}
            </span>
            <span>to</span>
            <span className="font-mono">
              {compactScanId(payload.afterScanId)} /{" "}
              {shortDate(payload.afterFinishedAt)}
            </span>
          </div>
        </div>
        <Badge variant={totalChanges ? "secondary" : "outline"}>
          {totalChanges} changes
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat
          label="Health delta"
          value={deltaLabel(diff.summary.healthDelta)}
          tone={healthTone(diff.summary.healthDelta)}
        />
        <Stat label="Nodes" value={diff.summary.nodesAdded - diff.summary.nodesRemoved} />
        <Stat label="Edges" value={diff.summary.edgesAdded - diff.summary.edgesRemoved} />
        <Stat
          label="Issues"
          value={diff.summary.issuesAdded - diff.summary.issuesRemoved}
          tone={diff.summary.issuesAdded ? "secondary" : "outline"}
        />
        <Stat
          label="Breaking"
          value={diff.summary.breakingChanges}
          tone={diff.summary.breakingChanges ? "destructive" : "outline"}
        />
      </div>

      {diff.breakingChanges.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Breaking Changes</CardTitle>
            <CardDescription>
              Contract changes detected from endpoints, route methods, and
              serializer-exposed fields.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {diff.breakingChanges.map((change, index) => (
              <div
                key={`${change.kind}:${index}`}
                className="rounded-lg border border-border bg-muted/20 p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="destructive">{change.kind}</Badge>
                  <Badge variant="outline">{change.severity}</Badge>
                </div>
                <p className="mt-2 text-sm">{change.message}</p>
                {change.nodes.length ? (
                  <div className="mt-2 flex flex-col gap-1 font-mono text-xs text-muted-foreground">
                    {change.nodes.map((node) => (
                      <span key={node} className="truncate">
                        {node}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Change Groups</CardTitle>
          <CardDescription>
            Added, removed, and changed graph elements from the diff engine.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {groups.length ? (
            groups.map(([kind, changes]) => (
              <section key={kind} className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-medium">{CHANGE_LABELS[kind]}</h2>
                  <Badge variant="outline">{changes.length}</Badge>
                </div>
                <ChangesTable changes={changes} />
              </section>
            ))
          ) : (
            <ChangesTable changes={[]} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
