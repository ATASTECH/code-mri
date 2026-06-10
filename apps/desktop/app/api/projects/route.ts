import {
  createAndScanProjectPayload,
  projectsPayload,
  type CreateProjectRequest,
} from "@/lib/server/project-service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function GET() {
  try {
    return Response.json(await projectsPayload())
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as CreateProjectRequest
    return Response.json(await createAndScanProjectPayload(input))
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 400 })
  }
}
