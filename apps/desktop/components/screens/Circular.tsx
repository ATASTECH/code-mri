import type { Report } from "@code-mri/shared-types"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function Circular({ report }: { report: Report }) {
  const byId = new Map(report.nodes.map((n) => [n.id, n]))
  const cycles = report.issues.filter((i) => i.kind === "CIRCULAR_DEPENDENCY")

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Import cycles detected via strongly-connected-component analysis.
      </p>
      {cycles.length === 0 && (
        <p className="text-muted-foreground">No circular dependencies.</p>
      )}
      {cycles.map((issue, idx) => (
        <Card key={idx}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Cycle of {issue.nodes.length} files
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-mono text-xs leading-relaxed">
              {issue.nodes.map((id) => byId.get(id)?.name ?? id).join("  →  ")}
              {"  →  "}
              <span className="text-muted-foreground">
                {byId.get(issue.nodes[0] ?? "")?.name ?? issue.nodes[0]}
              </span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
