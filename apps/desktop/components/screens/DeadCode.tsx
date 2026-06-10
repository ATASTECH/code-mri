"use client"

import type { Confidence, Issue, Report } from "@code-mri/shared-types"
import { useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

type DeadCodeFilter = "all" | "high" | "low" | "endpoint" | "dangling"

const FILTERS: Array<{ label: string; value: DeadCodeFilter }> = [
  { label: "All", value: "all" },
  { label: "Safe remove", value: "high" },
  { label: "Public API risk", value: "low" },
  { label: "Endpoints", value: "endpoint" },
  { label: "Dangling calls", value: "dangling" },
]

function issueConfidence(issue: Issue): Confidence | null {
  const confidence = issue.meta?.confidence
  return confidence === "high" ||
    confidence === "medium" ||
    confidence === "low"
    ? confidence
    : null
}

function confidenceLabel(confidence: Confidence | null): string {
  if (confidence === "high") return "safe remove"
  if (confidence === "low") return "public API risk"
  if (confidence === "medium") return "review"
  return "candidate"
}

function confidenceRank(issue: Issue): number {
  const confidence = issueConfidence(issue)
  if (confidence === "high") return 0
  if (confidence === "medium") return 1
  if (confidence === "low") return 2
  if (issue.kind === "UNUSED_ENDPOINT") return 3
  return 4
}

export function DeadCode({ report }: { report: Report }) {
  const [filter, setFilter] = useState<DeadCodeFilter>("all")
  const byId = new Map(report.nodes.map((n) => [n.id, n]))
  const dead = useMemo(
    () =>
      report.issues
        .filter((i) => i.kind === "DEAD_CODE" || i.kind === "UNUSED_ENDPOINT")
        .sort((a, b) => {
          const rank = confidenceRank(a) - confidenceRank(b)
          if (rank !== 0) return rank
          return a.message.localeCompare(b.message)
        }),
    [report.issues]
  )
  const dangling = useMemo(
    () => report.issues.filter((i) => i.kind === "DANGLING_API_CALL"),
    [report.issues]
  )
  const filteredDead = dead.filter((issue) => {
    if (filter === "all") return true
    if (filter === "endpoint") return issue.kind === "UNUSED_ENDPOINT"
    if (filter === "dangling") return false
    return issueConfidence(issue) === filter
  })
  const showDangling = filter === "all" || filter === "dangling"
  const visibleCount =
    filteredDead.length + (showDangling ? dangling.length : 0)

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Heuristic findings — every item is a <strong>candidate</strong>, not a
        certainty (dynamic usage and other API consumers can&apos;t be seen
        statically).
      </p>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <Button
            key={item.value}
            size="sm"
            variant={filter === item.value ? "default" : "outline"}
            onClick={() => setFilter(item.value)}
          >
            {item.label}
          </Button>
        ))}
      </div>
      {visibleCount === 0 && (
        <p className="text-muted-foreground">Nothing flagged.</p>
      )}
      <div className="flex flex-col gap-2">
        {filteredDead.map((issue, idx) => {
          const node = byId.get(issue.nodes[0] ?? "")
          const confidence = issueConfidence(issue)
          const exported = node?.meta?.exported
          return (
            <Card key={`${issue.kind}-${idx}`}>
              <CardContent className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    {node?.name ?? issue.nodes[0]}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {issue.message}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Badge variant="outline">{issue.kind}</Badge>
                  <Badge
                    variant={confidence === "high" ? "default" : "secondary"}
                  >
                    {confidenceLabel(confidence)}
                  </Badge>
                  {typeof exported === "boolean" ? (
                    <Badge variant="outline">
                      {exported ? "exported" : "internal"}
                    </Badge>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
      {showDangling && dangling.length ? (
        <div className="mt-4 flex flex-col gap-2">
          <div>
            <h3 className="font-medium">Dangling API calls</h3>
            <p className="text-sm text-muted-foreground">
              Frontend calls that did not match a scanned backend route.
              External APIs are ignored by the engine.
            </p>
          </div>
          {dangling.map((issue, idx) => {
            const node = byId.get(issue.nodes[0] ?? "")
            const meta = issue.meta as
              | { method?: unknown; url?: unknown }
              | undefined
            const method =
              typeof meta?.method === "string" ? meta.method : "API"
            const url = typeof meta?.url === "string" ? meta.url : issue.message

            return (
              <Card key={`${issue.kind}-${idx}`}>
                <CardContent className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {node?.name ?? issue.nodes[0]}
                    </div>
                    <div className="truncate font-mono text-xs text-muted-foreground">
                      {method} {url}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Badge variant="outline">DANGLING_API_CALL</Badge>
                    <Badge variant="secondary">no score impact</Badge>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
