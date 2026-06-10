import { promises as fs, readFileSync } from "node:fs";
import * as path from "node:path";
import { classifyFile, type FileCategory } from "./classify.js";
import { detectStack } from "./detect.js";
import { createIgnoreFilter } from "./ignore.js";

export interface ScanFile {
  /** Repo-relative path, POSIX separators. */
  path: string;
  /** Absolute path on disk. */
  abs: string;
  category: FileCategory;
}

export interface ScanResult {
  /** Absolute scanned root. */
  root: string;
  /** All kept files, sorted by `path`. */
  files: ScanFile[];
  /** Detected stack tags. */
  stack: string[];
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

async function readGitignore(root: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(path.join(root, ".gitignore"), "utf8");
    return raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));
  } catch {
    return [];
  }
}

/**
 * Recursively walk `root`, collecting repo-relative paths of kept files.
 * Ignored directories are pruned early so we never descend into them.
 */
async function walk(root: string, keep: (rel: string) => boolean): Promise<string[]> {
  const out: string[] = [];

  async function visit(dirAbs: string): Promise<void> {
    const entries = await fs.readdir(dirAbs, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(dirAbs, entry.name);
      const rel = toPosix(path.relative(root, abs));
      if (!keep(rel)) continue;
      if (entry.isDirectory()) {
        await visit(abs);
      } else if (entry.isFile()) {
        out.push(rel);
      }
    }
  }

  await visit(root);
  return out;
}

/** Scan a repository: walk, ignore, classify files, and detect the stack. */
export async function scanRepo(root: string): Promise<ScanResult> {
  const absRoot = path.resolve(root);
  const extra = await readGitignore(absRoot);
  const keep = createIgnoreFilter(extra);

  const relPaths = (await walk(absRoot, keep)).sort();

  const readFile = (rel: string): string | null => {
    try {
      return readFileSync(path.join(absRoot, rel), "utf8");
    } catch {
      return null;
    }
  };

  const files: ScanFile[] = relPaths.map((rel) => ({
    path: rel,
    abs: path.join(absRoot, rel),
    category: classifyFile(rel),
  }));

  const stack = detectStack(relPaths, readFile);

  return { root: absRoot, files, stack };
}
