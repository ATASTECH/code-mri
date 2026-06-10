import { scanProjectPayload } from "@/lib/server/project-service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params

  try {
    return Response.json(await scanProjectPayload(projectId))
  } catch (error) {
    return Response.json(
      { error: message(error) },
      { status: message(error) === "Project not found" ? 404 : 400 },
    )
  }
}
