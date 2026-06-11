"use client"

import type { Report } from "@code-mri/engine"
import { useMemo } from "react"
import { GraphFlow } from "@/components/GraphFlow"

const HIDDEN = new Set(["File", "Directory"])

export function ArchitectureMap({ report }: { report: Report }) {
  const { nodes, edges } = useMemo(() => {
    const nodes = report.nodes.filter((n) => !HIDDEN.has(n.kind))
    const ids = new Set(nodes.map((n) => n.id))
    const edges = report.edges.filter((e) => ids.has(e.from) && ids.has(e.to))
    return { nodes, edges }
  }, [report])

  return (
    <div className="flex h-full flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        Semantic stack map (files hidden). Columns flow backend → API →
        frontend.
      </p>
      <div className="min-h-0 flex-1 rounded-lg border border-border">
        <GraphFlow nodes={nodes} edges={edges} />
      </div>
    </div>
  )
}
