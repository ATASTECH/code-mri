import "server-only"

import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import * as path from "node:path"
import type { Report } from "@code-mri/shared-types"
import {
  buildEngineNodeArgs,
  buildScanProjectArgs,
  type EngineProjectInput,
  type EngineRepoInput,
} from "./engine-args"

export type { EngineProjectInput, EngineRepoInput }

export interface EngineScanProgress {
  type: "progress"
  phase: string
  percent: number
  message: string
  repoId?: string
}

/**
 * The scan engine depends on ts-morph, which embeds the entire TypeScript
 * compiler (>30MB across @ts-morph/common + typescript). Importing it directly
 * into a Next.js route makes Turbopack try to bundle those files on-demand,
 * which spikes dev memory by gigabytes per compile and can exhaust system RAM.
 *
 * To keep the engine completely out of the Next module graph, we run it as a
 * standalone child process (its CLI `scan-project` command) and read back the
 * JSON report. ts-morph then lives in its own short-lived process (~250MB) and
 * never touches the bundler.
 */

function resolveEngineCliPath(): string {
  const override = process.env.CODE_MRI_ENGINE_CLI
  if (override && override.trim()) return path.resolve(override.trim())

  const candidates = [
    path.resolve(process.cwd(), "../../engine/dist/cli/index.js"),
    path.resolve(process.cwd(), "../engine/dist/cli/index.js"),
    path.resolve(process.cwd(), "engine/dist/cli/index.js"),
  ]
  const workspaceCli = candidates.find((candidate) => existsSync(candidate))
  if (workspaceCli) return workspaceCli

  throw new Error(
    "Engine CLI not found. Run `pnpm --filter @code-mri/engine build` or set CODE_MRI_ENGINE_CLI.",
  )
}

export async function analyzeProjectReposViaCli(
  input: EngineProjectInput,
  opts: { onProgress?: (event: EngineScanProgress) => void } = {},
): Promise<{ report: Report }> {
  const cliPath = resolveEngineCliPath()
  const outFile = path.join(tmpdir(), `code-mri-report-${randomUUID()}.json`)

  const args = buildScanProjectArgs(cliPath, outFile, {
    ...input,
    progress: Boolean(opts.onProgress),
  })
  const nodeArgs = buildEngineNodeArgs(args, input.maxOldSpaceMb)

  try {
    await runChild(process.execPath, nodeArgs, opts.onProgress)
    const raw = await readFile(outFile, "utf8")
    return { report: JSON.parse(raw) as Report }
  } finally {
    await rm(outFile, { force: true })
  }
}

export function parseProgressLine(line: string): EngineScanProgress | null {
  try {
    const parsed = JSON.parse(line) as Partial<EngineScanProgress>
    if (
      parsed.type === "progress" &&
      typeof parsed.phase === "string" &&
      typeof parsed.percent === "number" &&
      typeof parsed.message === "string"
    ) {
      return {
        type: "progress",
        phase: parsed.phase,
        percent: parsed.percent,
        message: parsed.message,
        ...(typeof parsed.repoId === "string" ? { repoId: parsed.repoId } : {}),
      }
    }
  } catch {
    return null
  }
  return null
}

function runChild(
  command: string,
  args: string[],
  onProgress?: (event: EngineScanProgress) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stderr = ""
    let stdoutBuffer = ""
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString()
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() ?? ""
      for (const line of lines) {
        const event = parseProgressLine(line)
        if (event) onProgress?.(event)
      }
    })

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
      if (stderr.length > 64_000) stderr = stderr.slice(-64_000)
    })

    child.on("error", reject)
    child.on("close", (code) => {
      const event = stdoutBuffer ? parseProgressLine(stdoutBuffer) : null
      if (event) onProgress?.(event)
      if (code === 0) {
        resolve()
        return
      }
      const detail = stderr.trim()
      reject(
        new Error(
          detail ? `Engine scan failed: ${detail}` : `Engine scan exited with code ${code}`,
        ),
      )
    })
  })
}
