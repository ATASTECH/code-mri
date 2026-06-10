import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import type { TsFileFacts } from "./facts.js";

/** Bump when the fact shape changes so stale disk caches are discarded. */
export const CACHE_VERSION = 5;

export interface FactsCacheStats {
  hits: number;
  misses: number;
  size: number;
}

/**
 * Content-hash cache of per-file TS facts. Lets `analyzeTypeScript` skip
 * re-parsing unchanged files across scans. Keyed by (repo-relative path,
 * content hash) so a changed file naturally misses.
 */
export interface FactsCache {
  get(rel: string, hash: string): TsFileFacts | undefined;
  set(rel: string, hash: string, facts: TsFileFacts): void;
  stats(): FactsCacheStats;
}

/** A cache that can be persisted to disk. */
export interface PersistentFactsCache extends FactsCache {
  flush(): void;
}

/** Stable content hash used as the cache key component. */
export function hashContent(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

const key = (rel: string, hash: string): string => `${rel} ${hash}`;

interface Core extends FactsCache {
  /** Entries touched (read-hit or written) this run — used to compact on flush. */
  liveEntries(): Record<string, TsFileFacts>;
}

function createCore(initial?: Record<string, TsFileFacts>): Core {
  const store = new Map<string, TsFileFacts>(initial ? Object.entries(initial) : undefined);
  const touched = new Set<string>();
  let hits = 0;
  let misses = 0;

  return {
    get(rel, hash) {
      const k = key(rel, hash);
      const facts = store.get(k);
      if (facts) {
        hits++;
        touched.add(k);
      } else {
        misses++;
      }
      return facts;
    },
    set(rel, hash, facts) {
      const k = key(rel, hash);
      store.set(k, facts);
      touched.add(k);
    },
    stats() {
      return { hits, misses, size: store.size };
    },
    liveEntries() {
      const out: Record<string, TsFileFacts> = {};
      for (const k of touched) {
        const facts = store.get(k);
        if (facts) out[k] = facts;
      }
      return out;
    },
  };
}

export function createMemoryFactsCache(): FactsCache {
  const core = createCore();
  return { get: core.get, set: core.set, stats: core.stats };
}

interface DiskShape {
  version: number;
  entries: Record<string, TsFileFacts>;
}

function loadEntries(file: string): Record<string, TsFileFacts> {
  if (!existsSync(file)) return {};
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as DiskShape;
    if (data.version !== CACHE_VERSION || typeof data.entries !== "object") return {};
    return data.entries;
  } catch {
    return {};
  }
}

/**
 * Disk-backed facts cache. Loads any existing cache file on creation and
 * persists the merged set on `flush()`. A version mismatch or unreadable file
 * starts empty (safe: a miss just re-parses).
 */
export function createDiskFactsCache(file: string): PersistentFactsCache {
  const core = createCore(loadEntries(file));

  return {
    get: core.get,
    set: core.set,
    stats: core.stats,
    flush() {
      mkdirSync(path.dirname(file), { recursive: true });
      const payload: DiskShape = { version: CACHE_VERSION, entries: core.liveEntries() };
      // Atomic write: a torn/interleaved file from a concurrent scan (CLI +
      // desktop sharing a cache dir) would otherwise corrupt the cache.
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      writeFileSync(tmp, JSON.stringify(payload));
      renameSync(tmp, file);
    },
  };
}
