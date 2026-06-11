import type { Report } from "@code-mri/engine"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { deriveApiMap, deriveDanglingApiCalls } from "@/lib/apiMap"

const CONFIDENCE_TONE: Record<string, string> = {
  high: "default",
  medium: "secondary",
  low: "destructive",
}

export function ApiMap({ report }: { report: Report }) {
  const rows = deriveApiMap(report)
  const dangling = deriveDanglingApiCalls(report)
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Every endpoint joined to its ViewSet → Serializer → Model and the
        frontend caller.
      </p>
      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Method</TableHead>
              <TableHead>Path</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>ViewSet</TableHead>
              <TableHead>Serializer</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Frontend caller</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.endpointId}>
                <TableCell className="font-mono text-xs font-semibold">
                  {r.method}
                </TableCell>
                <TableCell className="font-mono text-xs">{r.path}</TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <Badge
                      variant={r.source === "openapi" ? "secondary" : "outline"}
                    >
                      {r.source ?? "code"}
                    </Badge>
                    {r.location ? (
                      <span className="max-w-40 truncate font-mono text-[11px] text-muted-foreground">
                        {r.location}
                      </span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>{r.viewset ?? "—"}</TableCell>
                <TableCell>{r.serializer ?? "—"}</TableCell>
                <TableCell>{r.model ?? "—"}</TableCell>
                <TableCell>
                  {r.caller ? (
                    <span className="flex items-center gap-2">
                      {r.caller}
                      {r.confidence && (
                        <Badge
                          variant={
                            (CONFIDENCE_TONE[r.confidence] ?? "outline") as
                              | "default"
                              | "secondary"
                              | "destructive"
                              | "outline"
                          }
                        >
                          {r.confidence}
                        </Badge>
                      )}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      no frontend caller
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {dangling.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Unmatched frontend calls</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Method</TableHead>
                    <TableHead>URL</TableHead>
                    <TableHead>Caller</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dangling.map((row) => (
                    <TableRow key={row.issueIndex}>
                      <TableCell className="font-mono text-xs font-semibold">
                        {row.method}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.url}
                      </TableCell>
                      <TableCell>{row.caller ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">no backend match</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
