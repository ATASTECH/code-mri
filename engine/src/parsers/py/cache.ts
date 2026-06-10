import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import type { PyAnalysis } from "./assemble.js";

/** Bump when PyAnalysis shape changes so stale disk caches are discarded. */
export const PY_CACHE_VERSION = 3;

export interface PyCacheStats {
  hits: number;
  misses: number;
}

/**
 * Whole-result cache for the Django/DRF analysis, keyed by a digest of all
 * python file contents. Lets the pipeline skip the python sidecar spawn + `ast`
 * parse entirely when no `.py` file changed.
 */
export interface PyCache {
  get(digest: string): PyAnalysis | undefined;
  set(digest: string, analysis: PyAnalysis): void;
  stats(): PyCacheStats;
}

export interface PersistentPyCache extends PyCache {
  flush(): void;
}

/**
 * Order-independent digest of the python files' contents. A present/missing tag
 * precedes each file's bytes so an unreadable file can never collide with a
 * readable one that happens to contain the sentinel text.
 */
export function pyFilesDigest(root: string, pyFiles: string[]): string {
  const hash = createHash("sha1");
  const SEP = "\0";
  for (const rel of [...pyFiles].sort()) {
    hash.update(rel).update(SEP);
    try {
      const content = readFileSync(path.resolve(root, rel), "utf8");
      hash.update("present").update(SEP).update(content);
    } catch {
      hash.update("missing");
    }
    hash.update(SEP);
  }
  return hash.digest("hex");
}

interface Core extends PyCache {
  /** Entries touched (read-hit or written) this run — used to compact on flush. */
  liveEntries(): Record<string, PyAnalysis>;
}

function createCore(initial?: Record<string, PyAnalysis>): Core {
  const store = new Map<string, PyAnalysis>(initial ? Object.entries(initial) : undefined);
  const touched = new Set<string>();
  let hits = 0;
  let misses = 0;

  return {
    get(digest) {
      const value = store.get(digest);
      if (value) {
        hits++;
        touched.add(digest);
      } else {
        misses++;
      }
      return value;
    },
    set(digest, analysis) {
      store.set(digest, analysis);
      touched.add(digest);
    },
    stats() {
      return { hits, misses };
    },
    liveEntries() {
      const out: Record<string, PyAnalysis> = {};
      for (const digest of touched) {
        const value = store.get(digest);
        if (value) out[digest] = value;
      }
      return out;
    },
  };
}

export function createMemoryPyCache(): PyCache {
  const core = createCore();
  return { get: core.get, set: core.set, stats: core.stats };
}

interface DiskShape {
  version: number;
  entries: Record<string, PyAnalysis>;
}

function loadEntries(file: string): Record<string, PyAnalysis> {
  if (!existsSync(file)) return {};
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as DiskShape;
    if (data.version !== PY_CACHE_VERSION || typeof data.entries !== "object") return {};
    return data.entries;
  } catch {
    return {};
  }
}

export function createDiskPyCache(file: string): PersistentPyCache {
  const core = createCore(loadEntries(file));

  return {
    get: core.get,
    set: core.set,
    stats: core.stats,
    flush() {
      mkdirSync(path.dirname(file), { recursive: true });
      const payload: DiskShape = { version: PY_CACHE_VERSION, entries: core.liveEntries() };
      // Atomic write (temp + rename) to survive a concurrent scan sharing the dir.
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      writeFileSync(tmp, JSON.stringify(payload));
      renameSync(tmp, file);
    },
  };
}
