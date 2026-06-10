import type { GraphNode } from "@code-mri/shared-types"
import { describe, expect, test } from "vitest"
import { layoutByKind } from "./layout"

const n = (id: string, kind: GraphNode["kind"]): GraphNode => ({ id, kind, name: id })

describe("layoutByKind", () => {
  test("same kind shares a column, different kinds get different columns", () => {
    const pos = layoutByKind([n("a", "Model"), n("b", "Model"), n("c", "Serializer")])
    expect(pos.get("a")?.x).toBe(pos.get("b")?.x)
    expect(pos.get("a")?.y).not.toBe(pos.get("b")?.y)
    expect(pos.get("c")?.x).not.toBe(pos.get("a")?.x)
  })
})
