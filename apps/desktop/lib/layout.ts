import type { GraphNode, NodeKind } from "@code-mri/shared-types"

/** Left-to-right column order, roughly following the backend → frontend flow. */
const COLUMN_ORDER: NodeKind[] = [
  "Field",
  "Type",
  "Model",
  "DatabaseTable",
  "Manager",
  "Signal",
  "Serializer",
  "ViewSet",
  "View",
  "Route",
  "APIEndpoint",
  "CeleryTask",
  "Service",
  "Context",
  "Hook",
  "Component",
  "Page",
  "File",
  "Directory",
  "DockerService",
  "EnvVariable",
  "Function",
  "Class",
]

const COL_WIDTH = 260
const ROW_HEIGHT = 136

export interface XY {
  x: number
  y: number
}

/** Deterministic column layout: one column per node kind, stacked vertically. */
export function layoutByKind(nodes: GraphNode[]): Map<string, XY> {
  const presentKinds = Array.from(new Set(nodes.map((node) => node.kind))).sort(
    (a, b) => {
      const aIndex = COLUMN_ORDER.indexOf(a)
      const bIndex = COLUMN_ORDER.indexOf(b)
      const normalizedA = aIndex === -1 ? COLUMN_ORDER.length : aIndex
      const normalizedB = bIndex === -1 ? COLUMN_ORDER.length : bIndex

      return normalizedA - normalizedB
    }
  )
  const colByKind = new Map(presentKinds.map((kind, index) => [kind, index]))
  const rowByCol = new Map<number, number>()
  const pos = new Map<string, XY>()
  for (const node of nodes) {
    const col = colByKind.get(node.kind) ?? presentKinds.length
    const row = rowByCol.get(col) ?? 0
    rowByCol.set(col, row + 1)
    pos.set(node.id, { x: col * COL_WIDTH, y: row * ROW_HEIGHT })
  }
  return pos
}
