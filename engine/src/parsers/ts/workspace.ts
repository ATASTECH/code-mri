import { readFileSync } from "node:fs";
import * as path from "node:path";
import type { WorkspacePackage } from "./resolveModule.js";

const toPosix = (p: string): string => p.replace(/\\/g, "/").replace(/^\.\//, "");

interface PackageJson {
  name?: unknown;
  main?: unknown;
  module?: unknown;
  exports?: unknown;
}

/** Best-effort entry file from main/module/exports["."], normalized & ./-stripped. */
function pickEntry(json: PackageJson): string | undefined {
  const fromExports = (exp: unknown): string | undefined => {
    if (typeof exp === "string") return exp;
    if (exp && typeof exp === "object") {
      const dot = (exp as Record<string, unknown>)["."] ?? exp;
      if (typeof dot === "string") return dot;
      if (dot && typeof dot === "object") {
        const d = dot as Record<string, unknown>;
        const v = d.import ?? d.default ?? d.require;
        if (typeof v === "string") return v;
      }
    }
    return undefined;
  };
  const raw =
    (typeof json.module === "string" && json.module) ||
    (typeof json.main === "string" && json.main) ||
    fromExports(json.exports);
  return raw ? toPosix(String(raw).replace(/^\.\//, "")) : undefined;
}

/**
 * Discover monorepo workspace packages by reading every `package.json` in the
 * scanned file set. Each named package maps to its directory + entry file so the
 * module resolver can follow `@acme/ui` imports across packages.
 */
export function readWorkspacePackages(root: string, relPaths: string[]): WorkspacePackage[] {
  const out: WorkspacePackage[] = [];
  for (const rel of relPaths) {
    const posix = toPosix(rel);
    if (path.posix.basename(posix) !== "package.json") continue;
    let json: PackageJson;
    try {
      json = JSON.parse(readFileSync(path.join(root, rel), "utf8")) as PackageJson;
    } catch {
      continue;
    }
    if (typeof json.name !== "string" || json.name.length === 0) continue;
    const dir = path.posix.dirname(posix);
    out.push({ name: json.name, dir: dir === "." ? "" : dir, entry: pickEntry(json) });
  }
  return out;
}
