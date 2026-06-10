import "server-only"

import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export interface GitState {
  gitHead: string | null
  gitDirty: boolean
}

async function git(root: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", root, ...args], {
      timeout: 5000,
    })
    return stdout.trim()
  } catch {
    return null
  }
}

export async function readGitState(root: string): Promise<GitState> {
  const head = await git(root, ["rev-parse", "HEAD"])
  const status = await git(root, ["status", "--porcelain"])

  return {
    gitHead: head,
    gitDirty: status !== null && status.length > 0,
  }
}
