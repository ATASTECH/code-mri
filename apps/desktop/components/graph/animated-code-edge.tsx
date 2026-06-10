"use client"

import type { Confidence, EdgeKind } from "@code-mri/shared-types"
import type { CSSProperties } from "react"
import type { Edge, EdgeProps } from "@xyflow/react"
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
} from "@xyflow/react"

export interface AnimatedCodeEdgeData extends Record<string, unknown> {
  active: boolean
  accent: string
  confidence?: Confidence
  duration: number
  kind: EdgeKind
  path: "bezier" | "smoothstep" | "straight"
}

export type AnimatedCodeEdgeType = Edge<
  AnimatedCodeEdgeData,
  "animatedCodeEdge"
>

function getEdgePath(props: EdgeProps<AnimatedCodeEdgeType>) {
  const pathParams = {
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
  }

  if (props.data?.path === "bezier") {
    return getBezierPath(pathParams)
  }

  if (props.data?.path === "straight") {
    return getStraightPath(pathParams)
  }

  return getSmoothStepPath(pathParams)
}

function AnimatedCodeEdge(props: EdgeProps<AnimatedCodeEdgeType>) {
  const { data, id, markerEnd, selected } = props
  const [edgePath, labelX, labelY] = getEdgePath(props)
  const accent = data?.accent ?? "#84cc16"
  const duration = data?.duration ?? 2.2
  const label = data?.confidence
    ? `${data.kind} · ${data.confidence}`
    : data?.kind

  return (
    <g
      className="code-mri-edge"
      style={{ "--edge-accent": accent } as CSSProperties}
    >
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        interactionWidth={22}
        label={label}
        labelX={labelX}
        labelY={labelY}
        labelStyle={{
          fill: "var(--muted-foreground)",
          fontSize: 10,
          fontWeight: 600,
        }}
        labelBgPadding={[7, 4]}
        labelBgBorderRadius={999}
        labelBgStyle={{
          fill: "var(--background)",
          fillOpacity: 0.84,
          stroke: "var(--border)",
          strokeWidth: 1,
        }}
        style={{
          stroke: accent,
          strokeDasharray: data?.active ? "7 7" : undefined,
          strokeOpacity: selected ? 0.95 : 0.58,
          strokeWidth: selected ? 2.5 : 1.8,
          ...props.style,
        }}
      />
      {data?.active ? (
        <>
          <circle
            r="4"
            fill={accent}
            opacity="0.9"
            className="code-mri-edge-particle"
          >
            <animateMotion
              dur={`${duration}s`}
              path={edgePath}
              repeatCount="indefinite"
            />
          </circle>
          <path
            d="M -5 -3 L 5 0 L -5 3 Z"
            fill={accent}
            opacity="0.72"
            className="code-mri-edge-particle"
          >
            <animateMotion
              dur={`${duration * 1.35}s`}
              path={edgePath}
              repeatCount="indefinite"
              rotate="auto"
            />
          </path>
        </>
      ) : null}
      <EdgeLabelRenderer>
        <div
          className="pointer-events-none absolute size-1.5 rounded-full bg-[var(--edge-accent)] opacity-70"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
          }}
        />
      </EdgeLabelRenderer>
    </g>
  )
}

export { AnimatedCodeEdge }
