import type {
  Confidence,
  GraphEdge,
  GraphNode,
  Issue,
  NodeKind,
} from "@code-mri/engine"
import type { ReportGraph } from "./impact"

export interface ApiRow {
  endpointId: string
  method: string
  path: string
  source?: string
  location?: string
  viewset?: string
  serializer?: string
  model?: string
  caller?: string
  confidence?: Confidence
}

export interface DanglingApiCallRow {
  issueIndex: number
  caller?: string
  method: string
  url: string
  message: string
}

/** Derive an endpoint-centric table joining the full backend → frontend chain. */
export function deriveApiMap(report: ReportGraph): ApiRow[] {
  const byId = new Map(report.nodes.map((n) => [n.id, n]))
  const inByTo = new Map<string, GraphEdge[]>()
  const outByFrom = new Map<string, GraphEdge[]>()
  for (const e of report.edges) {
    ;(inByTo.get(e.to) ?? inByTo.set(e.to, []).get(e.to)!).push(e)
    ;(outByFrom.get(e.from) ?? outByFrom.set(e.from, []).get(e.from)!).push(e)
  }

  const firstTargetOfKind = (
    edges: GraphEdge[] | undefined,
    edgeKind: GraphEdge["kind"],
    nodeKind: NodeKind
  ): GraphNode | undefined => {
    for (const e of edges ?? []) {
      if (e.kind !== edgeKind) continue
      const target = byId.get(e.to)
      if (target?.kind === nodeKind) return target
    }
    return undefined
  }

  const rows: ApiRow[] = []
  for (const node of report.nodes) {
    if (node.kind !== "APIEndpoint") continue

    const meta = (node.meta ?? {}) as {
      method?: string
      path?: string
      source?: string
    }
    const [fallbackMethod, fallbackPath] = node.name.split(" ")

    // endpoint ← EXPOSES ← viewset
    const viewsetEdge = (inByTo.get(node.id) ?? []).find(
      (e) => e.kind === "EXPOSES"
    )
    const viewset = viewsetEdge ? byId.get(viewsetEdge.from) : undefined

    const serializer = viewset
      ? firstTargetOfKind(outByFrom.get(viewset.id), "USES", "Serializer")
      : undefined
    const model = serializer
      ? firstTargetOfKind(outByFrom.get(serializer.id), "USES", "Model")
      : undefined

    const callsEdge = (inByTo.get(node.id) ?? []).find(
      (e) => e.kind === "CALLS"
    )
    const caller = callsEdge ? byId.get(callsEdge.from) : undefined

    rows.push({
      endpointId: node.id,
      method: meta.method ?? fallbackMethod ?? "",
      path: meta.path ?? fallbackPath ?? "",
      source: typeof meta.source === "string" ? meta.source : undefined,
      location: node.loc?.line
        ? `${node.loc.file}:${node.loc.line}`
        : node.loc?.file,
      viewset: viewset?.name,
      serializer: serializer?.name,
      model: model?.name,
      caller: caller?.name,
      confidence: callsEdge?.confidence,
    })
  }

  return rows.sort((a, b) =>
    `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`)
  )
}

export function deriveDanglingApiCalls(report: {
  nodes: GraphNode[]
  issues: Issue[]
}): DanglingApiCallRow[] {
  const byId = new Map(report.nodes.map((n) => [n.id, n]))

  return report.issues
    .map((issue, issueIndex): DanglingApiCallRow | null => {
      if (issue.kind !== "DANGLING_API_CALL") return null

      const meta = issue.meta as { method?: unknown; url?: unknown } | undefined
      const caller = byId.get(issue.nodes[0] ?? "")

      return {
        issueIndex,
        caller: caller?.name ?? issue.nodes[0],
        method: typeof meta?.method === "string" ? meta.method : "API",
        url: typeof meta?.url === "string" ? meta.url : issue.message,
        message: issue.message,
      }
    })
    .filter((row): row is DanglingApiCallRow => row !== null)
}
