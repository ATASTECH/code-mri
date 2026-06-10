"use client"

import type { GraphEdge, GraphNode } from "@code-mri/shared-types"
import {
  Background,
  BackgroundVariant,
  type ColorMode,
  Controls,
  type EdgeTypes,
  MarkerType,
  type NodeTypes,
  Panel,
  Position,
  ReactFlow,
} from "@xyflow/react"
import { useTheme } from "next-themes"
import { useMemo } from "react"
import {
  ArchitectureNode,
  type ArchitectureNodeType,
} from "@/components/graph/architecture-node"
import {
  AnimatedCodeEdge,
  type AnimatedCodeEdgeType,
} from "@/components/graph/animated-code-edge"
import {
  getEdgeAccent,
  getKindTheme,
  isAnimatedEdge,
} from "@/components/graph/graph-theme"
import { Badge } from "@/components/ui/badge"
import { layoutByKind } from "@/lib/layout"

const nodeTypes = {
  architecture: ArchitectureNode,
} satisfies NodeTypes

const edgeTypes = {
  animatedCodeEdge: AnimatedCodeEdge,
} satisfies EdgeTypes

export interface GraphFlowProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** Node to emphasise (e.g. the impact root). */
  highlightId?: string
  onSelect?: (id: string) => void
}

export function GraphFlow({
  nodes,
  edges,
  highlightId,
  onSelect,
}: GraphFlowProps) {
  const { theme = "system" } = useTheme()
  const colorMode: ColorMode =
    theme === "dark" || theme === "light" ? theme : "system"

  const { rfNodes, rfEdges } = useMemo(() => {
    const pos = layoutByKind(nodes)
    const incoming = new Map<string, number>()
    const outgoing = new Map<string, number>()

    for (const edge of edges) {
      incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1)
      outgoing.set(edge.from, (outgoing.get(edge.from) ?? 0) + 1)
    }

    const rfNodes: ArchitectureNodeType[] = nodes.map((n) => {
      const theme = getKindTheme(n.kind)
      const isHighlight = n.id === highlightId
      const exported =
        typeof n.meta?.exported === "boolean" ? n.meta.exported : undefined
      const hotspotScore =
        typeof n.meta?.hotspotScore === "number" ? n.meta.hotspotScore : undefined
      const coveragePct =
        typeof n.meta?.coveragePct === "number" ? n.meta.coveragePct : undefined
      const churn = typeof n.meta?.churn === "number" ? n.meta.churn : undefined

      return {
        id: n.id,
        type: "architecture",
        position: pos.get(n.id) ?? { x: 0, y: 0 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: {
          accent: theme.accent,
          highlight: isHighlight,
          incoming: incoming.get(n.id) ?? 0,
          kind: n.kind,
          name: n.name,
          outgoing: outgoing.get(n.id) ?? 0,
          path: n.loc?.file,
          exported,
          hotspotScore,
          coveragePct,
          churn,
          shortLabel: theme.label,
        },
      }
    })

    const rfEdges: AnimatedCodeEdgeType[] = edges.map((e, index) => {
      const accent = getEdgeAccent(e.kind, e.confidence)
      const highlighted = e.from === highlightId || e.to === highlightId
      const active = highlighted || isAnimatedEdge(e.kind)

      return {
        id: e.id,
        type: "animatedCodeEdge",
        source: e.from,
        target: e.to,
        data: {
          accent,
          active,
          confidence: e.confidence,
          duration: 1.9 + (index % 4) * 0.25,
          kind: e.kind,
          path: e.kind === "REFERENCES" ? "bezier" : "smoothstep",
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: accent,
          width: 14,
          height: 14,
        },
        zIndex: active ? 10 : 1,
      }
    })

    return { rfNodes, rfEdges }
  }, [nodes, edges, highlightId])

  return (
    <div className="code-mri-flow h-full w-full">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        colorMode={colorMode}
        fitView
        fitViewOptions={{ padding: 0.06 }}
        minZoom={0.1}
        maxZoom={1.6}
        nodesConnectable={false}
        edgesReconnectable={false}
        onNodeClick={(_, node) => onSelect?.(node.id)}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1.25}
          color="var(--code-mri-flow-grid)"
        />
        <Panel
          position="top-left"
          className="flex items-center gap-1.5 rounded-xl border border-border/80 bg-background/85 p-1.5 shadow-sm backdrop-blur-md"
        >
          <Badge variant="secondary">{nodes.length} nodes</Badge>
          <Badge variant="outline">{edges.length} links</Badge>
          <Badge className="border-lime-500/30 bg-lime-500/12 text-lime-700 dark:text-lime-300">
            live flow
          </Badge>
        </Panel>
        <Controls position="bottom-right" showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
