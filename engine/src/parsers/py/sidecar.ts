import { spawn } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { PyFacts } from "./assemble.js";

const SCRIPT = path.join(
  /* turbopackIgnore: true */ path.dirname(fileURLToPath(import.meta.url)),
  "../py-sidecar/analyzer.py",
);

export interface SidecarOptions {
  /** Python executable to use. Defaults to $CODE_MRI_PYTHON or "python3". */
  python?: string;
}

/**
 * Run the Django analyzer sidecar over `files` (repo-relative paths under `root`)
 * and return the parsed fact bundle. Rejects on non-zero exit or invalid output.
 */
export function runSidecar(
  root: string,
  files: string[],
  opts: SidecarOptions = {},
): Promise<PyFacts> {
  const python = opts.python ?? process.env.CODE_MRI_PYTHON ?? "python3";
  return new Promise((resolve, reject) => {
    const child = spawn(python, [SCRIPT], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`python sidecar exited with ${code}: ${err.trim()}`));
        return;
      }
      try {
        resolve(JSON.parse(out) as PyFacts);
      } catch (e) {
        reject(new Error(`invalid sidecar output: ${(e as Error).message}`));
      }
    });
    child.stdin.write(JSON.stringify({ root, files }));
    child.stdin.end();
  });
}
