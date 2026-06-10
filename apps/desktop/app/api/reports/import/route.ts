import type { Report } from "@code-mri/shared-types"
import { importReportPayload } from "@/lib/server/project-service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function POST(request: Request) {
  try {
    const report = (await request.json()) as Report
    if (!report?.project || !Array.isArray(report.nodes) || !Array.isArray(report.edges)) {
      throw new Error("Invalid Code MRI report JSON")
    }

    return Response.json(await importReportPayload(report))
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 400 })
  }
}
