import type { GraphEdge, GraphNode } from "@code-mri/shared-types"
import { describe, expect, test } from "vitest"
import { deriveApiMap, deriveDanglingApiCalls } from "./apiMap"

const nodes: GraphNode[] = [
  { id: "V", kind: "ViewSet", name: "UserViewSet" },
  { id: "S", kind: "Serializer", name: "UserSerializer" },
  { id: "M", kind: "Model", name: "User" },
  {
    id: "E",
    kind: "APIEndpoint",
    name: "GET /api/users/",
    loc: { file: "backend/users/views.py", line: 12 },
    meta: { method: "GET", path: "/api/users/" },
  },
  { id: "H", kind: "Hook", name: "useUsersQuery" },
]
const edges: GraphEdge[] = [
  { id: "EXPOSES:V->E", from: "V", to: "E", kind: "EXPOSES" },
  { id: "USES:V->S", from: "V", to: "S", kind: "USES" },
  { id: "USES:S->M", from: "S", to: "M", kind: "USES" },
  { id: "CALLS:H->E", from: "H", to: "E", kind: "CALLS", confidence: "high" },
]

describe("deriveApiMap", () => {
  test("joins endpoint → viewset → serializer → model and the frontend caller", () => {
    const rows = deriveApiMap({ nodes, edges })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      method: "GET",
      path: "/api/users/",
      location: "backend/users/views.py:12",
      viewset: "UserViewSet",
      serializer: "UserSerializer",
      model: "User",
      caller: "useUsersQuery",
      confidence: "high",
    })
  })

  test("leaves caller empty for an uncalled endpoint", () => {
    const rows = deriveApiMap({
      nodes: [
        {
          id: "E2",
          kind: "APIEndpoint",
          name: "POST /api/x/",
          loc: { file: "openapi.yaml" },
          meta: { method: "POST", path: "/api/x/", source: "openapi" },
        },
      ],
      edges: [],
    })
    expect(rows[0]?.caller).toBeUndefined()
    expect(rows[0]).toMatchObject({
      source: "openapi",
      location: "openapi.yaml",
    })
  })

  test("derives dangling API calls from issues", () => {
    const rows = deriveDanglingApiCalls({
      nodes,
      issues: [
        {
          kind: "DANGLING_API_CALL",
          severity: "info",
          message: 'Call "GET /api/ghost/" matches no known backend route',
          nodes: ["H"],
          candidate: true,
          meta: { method: "GET", url: "/api/ghost/" },
        },
      ],
    })

    expect(rows).toEqual([
      {
        issueIndex: 0,
        caller: "useUsersQuery",
        method: "GET",
        url: "/api/ghost/",
        message: 'Call "GET /api/ghost/" matches no known backend route',
      },
    ])
  })
})
