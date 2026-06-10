import type { ProjectRepoRole } from "@code-mri/shared-types"

export interface EngineRepoInput {
  id: string
  name: string
  root: string
  role: ProjectRepoRole
}

export interface EngineProjectInput {
  projectName: string
  repos: EngineRepoInput[]
  /** Persistent incremental cache dir; enables incremental re-scans when set. */
  cacheDir?: string
  /** Bypass cache even when a cache dir exists. */
  noCache?: boolean
  /** Ask the engine CLI to stream JSONL progress events. */
  progress?: boolean
  /** Explicit .codemri.yml path. Engine auto-discovery is used when omitted. */
  configPath?: string
  /** Node old-space cap for the child engine process, in MB. */
  maxOldSpaceMb?: number
}

function repoSpec(repo: EngineRepoInput): string {
  return `${repo.id}=${repo.root}:${repo.role}`
}

/**
 * Build the argv for the engine `scan-project` CLI command. Pure (no spawn) so
 * it can be unit-tested without invoking the engine or importing server-only.
 */
export function buildScanProjectArgs(
  cliPath: string,
  outFile: string,
  input: EngineProjectInput,
): string[] {
  const args = [cliPath, "scan-project", "--name", input.projectName, "--json", outFile]
  for (const repo of input.repos) {
    args.push("--repo", repoSpec(repo))
    args.push("--repo-name", `${repo.id}=${repo.name}`)
  }
  const python = process.env.CODE_MRI_PYTHON?.trim()
  if (python) args.push("--python", python)
  const configPath = input.configPath ?? process.env.CODE_MRI_CONFIG?.trim()
  if (configPath) args.push("--config", configPath)
  if (input.cacheDir) args.push("--cache-dir", input.cacheDir)
  if (input.noCache || process.env.CODE_MRI_NO_CACHE === "1") args.push("--no-cache")
  if (input.progress) args.push("--progress")
  return args
}

export function engineMaxOldSpaceMb(input?: number): number | undefined {
  const raw = input ?? Number(process.env.CODE_MRI_ENGINE_MAX_OLD_SPACE_MB)
  if (!Number.isFinite(raw) || raw <= 0) return 4096
  return Math.round(raw)
}

export function buildEngineNodeArgs(cliArgs: string[], maxOldSpaceMb?: number): string[] {
  const limit = engineMaxOldSpaceMb(maxOldSpaceMb)
  return limit ? [`--max-old-space-size=${limit}`, ...cliArgs] : cliArgs
}
