"use client"

import type { NodeKind } from "@code-mri/engine"
import type { LucideIcon } from "lucide-react"
import {
  BoxIcon,
  BracesIcon,
  Code2Icon,
  ComponentIcon,
  DatabaseIcon,
  FileCodeIcon,
  GitBranchIcon,
  GlobeIcon,
  KeyRoundIcon,
  LayersIcon,
  RouteIcon,
  ServerIcon,
  Share2Icon,
  Table2Icon,
  VariableIcon,
  WorkflowIcon,
  ZapIcon,
} from "lucide-react"
import type { CSSProperties } from "react"
import type { Node, NodeProps } from "@xyflow/react"
import { Handle, Position } from "@xyflow/react"

import { cn } from "@/lib/utils"

export interface ArchitectureNodeData extends Record<string, unknown> {
  accent: string
  highlight: boolean
  incoming: number
  kind: NodeKind
  name: string
  outgoing: number
  path?: string
  exported?: boolean
  hotspotScore?: number
  coveragePct?: number | null
  churn?: number
  shortLabel: string
}

export type ArchitectureNodeType = Node<ArchitectureNodeData, "architecture">

const KIND_ICON: Partial<Record<NodeKind, LucideIcon>> = {
  Field: BracesIcon,
  Type: BracesIcon,
  Context: Share2Icon,
  Model: DatabaseIcon,
  Manager: KeyRoundIcon,
  Signal: ZapIcon,
  DatabaseTable: Table2Icon,
  Serializer: LayersIcon,
  ViewSet: ServerIcon,
  View: ServerIcon,
  Route: RouteIcon,
  APIEndpoint: GlobeIcon,
  CeleryTask: ZapIcon,
  Service: WorkflowIcon,
  Hook: GitBranchIcon,
  Component: ComponentIcon,
  Page: BoxIcon,
  Function: Code2Icon,
  Class: BoxIcon,
  File: FileCodeIcon,
  Directory: FileCodeIcon,
  DockerService: ServerIcon,
  EnvVariable: VariableIcon,
}

function ArchitectureNode({ data, selected }: NodeProps<ArchitectureNodeType>) {
  const Icon = KIND_ICON[data.kind] ?? BoxIcon

  return (
    <div
      className={cn(
        "code-mri-node group relative w-[214px] overflow-hidden rounded-xl border bg-card/95 text-card-foreground shadow-sm backdrop-blur-sm transition-all duration-200",
        "hover:-translate-y-0.5 hover:shadow-md",
        selected && "ring-2 ring-ring/40",
        data.highlight && "code-mri-node-highlight"
      )}
      style={{ "--node-accent": data.accent } as CSSProperties}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="code-mri-handle code-mri-handle-target"
      />
      <div className="absolute inset-x-0 top-0 h-1 bg-[var(--node-accent)]" />
      <div className="pointer-events-none absolute -top-10 right-2 size-20 rounded-full bg-[var(--node-accent)] opacity-10 blur-2xl" />
      <div className="flex items-start gap-3 p-3.5">
        <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border border-[color-mix(in_oklch,var(--node-accent),transparent_50%)] bg-[color-mix(in_oklch,var(--node-accent),transparent_86%)] text-[var(--node-accent)]">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[11px] font-semibold tracking-normal text-muted-foreground uppercase">
              {data.shortLabel}
            </span>
            {typeof data.exported === "boolean" ? (
              <span className="rounded-full border border-border bg-muted/55 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                {data.exported ? "exported" : "internal"}
              </span>
            ) : null}
            {typeof data.hotspotScore === "number" && data.hotspotScore > 0 ? (
              <span className="rounded-full border border-orange-500/30 bg-orange-500/12 px-1.5 py-0.5 text-[9px] font-medium text-orange-700 dark:text-orange-300">
                hot {data.hotspotScore}
              </span>
            ) : null}
            {data.highlight ? (
              <span className="relative flex size-2.5 shrink-0">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--node-accent)] opacity-40" />
                <span className="relative inline-flex size-2.5 rounded-full bg-[var(--node-accent)]" />
              </span>
            ) : null}
          </div>
          <div className="mt-1 line-clamp-2 text-sm leading-snug font-semibold break-words">
            {data.name}
          </div>
          {data.path ? (
            <div className="mt-2 truncate font-mono text-[10px] text-muted-foreground">
              {data.path}
            </div>
          ) : null}
          {typeof data.coveragePct === "number" || typeof data.churn === "number" ? (
            <div className="mt-2 flex flex-wrap gap-1.5 text-[9px] text-muted-foreground">
              {typeof data.coveragePct === "number" ? (
                <span className="rounded-full bg-muted px-1.5 py-0.5">
                  cov {data.coveragePct}%
                </span>
              ) : null}
              {typeof data.churn === "number" && data.churn > 0 ? (
                <span className="rounded-full bg-muted px-1.5 py-0.5">
                  churn {data.churn}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <div className="grid grid-cols-2 border-t border-border/70 bg-muted/35 text-[10px] text-muted-foreground">
        <div className="flex items-center justify-between border-r border-border/70 px-3 py-2">
          <span>In</span>
          <span className="font-mono text-foreground">{data.incoming}</span>
        </div>
        <div className="flex items-center justify-between px-3 py-2">
          <span>Out</span>
          <span className="font-mono text-foreground">{data.outgoing}</span>
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="code-mri-handle code-mri-handle-source"
      />
    </div>
  )
}

export { ArchitectureNode }
