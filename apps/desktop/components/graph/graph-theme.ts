import type {
  Confidence,
  EdgeKind,
  NodeKind,
} from "@code-mri/engine"

export interface KindTheme {
  accent: string
  label: string
}

const KIND_THEME: Partial<Record<NodeKind, KindTheme>> = {
  Field: { accent: "#84cc16", label: "Field" },
  Type: { accent: "#14b8a6", label: "Type" },
  Context: { accent: "#8b5cf6", label: "Context" },
  Model: { accent: "#2563eb", label: "Model" },
  Manager: { accent: "#0f766e", label: "Manager" },
  Signal: { accent: "#a21caf", label: "Signal" },
  DatabaseTable: { accent: "#65a30d", label: "Table" },
  Serializer: { accent: "#0891b2", label: "Serializer" },
  ViewSet: { accent: "#059669", label: "ViewSet" },
  View: { accent: "#10b981", label: "View" },
  Route: { accent: "#d97706", label: "Route" },
  APIEndpoint: { accent: "#f59e0b", label: "Endpoint" },
  CeleryTask: { accent: "#9333ea", label: "Task" },
  Service: { accent: "#ea580c", label: "Service" },
  Hook: { accent: "#db2777", label: "Hook" },
  Component: { accent: "#e11d48", label: "Component" },
  Page: { accent: "#dc2626", label: "Page" },
  Function: { accent: "#4f46e5", label: "Function" },
  Class: { accent: "#7c3aed", label: "Class" },
  File: { accent: "#64748b", label: "File" },
  Directory: { accent: "#475569", label: "Directory" },
  DockerService: { accent: "#0ea5e9", label: "Docker" },
  EnvVariable: { accent: "#14b8a6", label: "Env" },
}

const EDGE_ACCENT: Partial<Record<EdgeKind, string>> = {
  CALLS: "#84cc16",
  EXPOSES: "#22c55e",
  RENDERS: "#f43f5e",
  IMPORTS: "#64748b",
  EXPORTS: "#64748b",
  USES: "#3b82f6",
  DEPENDS_ON: "#a855f7",
  REFERENCES: "#06b6d4",
  REGISTERED_IN: "#f59e0b",
  TYPES: "#14b8a6",
  PROVIDES: "#8b5cf6",
  CONSUMES: "#c084fc",
}

const CONFIDENCE_ACCENT: Partial<Record<Confidence, string>> = {
  high: "#84cc16",
  medium: "#f59e0b",
  low: "#ef4444",
}

export function getKindTheme(kind: NodeKind): KindTheme {
  return KIND_THEME[kind] ?? { accent: "#64748b", label: kind }
}

export function getEdgeAccent(kind: EdgeKind, confidence?: Confidence): string {
  return confidence
    ? (CONFIDENCE_ACCENT[confidence] ?? "#64748b")
    : (EDGE_ACCENT[kind] ?? "#64748b")
}

export function isAnimatedEdge(kind: EdgeKind): boolean {
  return (
    kind === "CALLS" ||
    kind === "EXPOSES" ||
    kind === "RENDERS" ||
    kind === "PROVIDES" ||
    kind === "CONSUMES"
  )
}
