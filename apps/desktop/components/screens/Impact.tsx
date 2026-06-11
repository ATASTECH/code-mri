"use client"

import type { Report } from "@code-mri/engine"
import { useMemo, useState } from "react"
import { GraphFlow } from "@/components/GraphFlow"
import { Badge } from "@/components/ui/badge"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { impactSubgraph } from "@/lib/impact"

/** Node kinds worth picking as an impact root (skip raw files/dirs). */
const PICKABLE = new Set([
  "Field",
  "Type",
  "Context",
  "Model",
  "Manager",
  "Signal",
  "Serializer",
  "ViewSet",
  "View",
  "APIEndpoint",
  "Hook",
  "Component",
  "Page",
])

export function Impact({ report }: { report: Report }) {
  const choices = useMemo(
    () =>
      report.nodes
        .filter((n) => PICKABLE.has(n.kind))
        .sort((a, b) =>
          `${a.kind} ${a.name}`.localeCompare(`${b.kind} ${b.name}`)
        ),
    [report]
  )

  const defaultId =
    choices.find((n) => n.kind === "Field" && n.name === "email")?.id ??
    choices[0]?.id ??
    ""
  const [selected, setSelected] = useState(defaultId)

  const sub = useMemo(
    () => impactSubgraph(report, selected),
    [report, selected]
  )
  const impactedCount = Math.max(0, sub.nodes.length - 1)

  return (
    <div className="flex h-full flex-col gap-3">
      <FieldGroup>
        <Field orientation="responsive">
          <FieldLabel htmlFor="impact-node">If this changes</FieldLabel>
          <Select
            value={selected}
            onValueChange={(value) => {
              if (value) setSelected(value)
            }}
          >
            <SelectTrigger id="impact-node" className="min-w-72">
              <SelectValue placeholder="Select node" />
            </SelectTrigger>
            <SelectContent align="start">
              <SelectGroup>
                {choices.map((node) => (
                  <SelectItem key={node.id} value={node.id}>
                    {node.kind} · {node.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Badge variant="secondary">{impactedCount} affected</Badge>
        </Field>
      </FieldGroup>
      <div className="min-h-0 flex-1 rounded-lg border border-border">
        <GraphFlow
          nodes={sub.nodes}
          edges={sub.edges}
          highlightId={selected}
          onSelect={setSelected}
        />
      </div>
    </div>
  )
}
