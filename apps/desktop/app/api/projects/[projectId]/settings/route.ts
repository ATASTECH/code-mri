import {
  updateProjectSettingsPayload,
  type UpdateProjectSettingsRequest,
} from "@/lib/server/project-service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params

  try {
    const input = (await request.json()) as UpdateProjectSettingsRequest
    return Response.json(await updateProjectSettingsPayload(projectId, input))
  } catch (error) {
    return Response.json(
      { error: message(error) },
      { status: message(error) === "Project not found" ? 404 : 400 },
    )
  }
}
