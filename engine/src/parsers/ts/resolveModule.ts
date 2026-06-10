import * as path from "node:path";

/** A workspace package discovered from a `package.json` in the scanned tree. */
export interface WorkspacePackage {
  /** Declared package name, e.g. "@acme/ui". */
  name: string;
  /** Repo-relative directory of the package (where its package.json lives). */
  dir: string;
  /** Entry file relative to `dir` (from main/module/exports), if known. */
  entry?: string;
}

export interface ModuleResolverConfig {
  /** Repo-relative paths that exist in the scan (e.g. "components/UserTable.tsx"). */
  files: Iterable<string>;
  /** tsconfig baseUrl, repo-relative. Defaults to ".". */
  baseUrl?: string;
  /** tsconfig `paths` map; targets are relative to baseUrl. */
  paths?: Record<string, string[]>;
  /** Monorepo workspace packages, so `@acme/ui` imports resolve cross-package. */
  workspaces?: WorkspacePackage[];
}

export type ModuleResolver = (fromRel: string, specifier: string) => string | null;

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const INDEX_FILES = EXTENSIONS.map((ext) => `index${ext}`);

const toPosix = (p: string): string => p.replace(/\\/g, "/").replace(/^\.\//, "");

/**
 * Build a content-independent module resolver over a known set of repo-relative
 * files. Replaces ts-morph's `getModuleSpecifierSourceFile()` so unchanged files
 * need not be parsed to resolve imports. Resolves relative specifiers (with
 * extension and index fallback) and tsconfig `paths` aliases; returns null for
 * external packages or anything outside the scanned file set.
 */
export function createModuleResolver(cfg: ModuleResolverConfig): ModuleResolver {
  const fileSet = new Set<string>();
  for (const f of cfg.files) fileSet.add(toPosix(f));

  // `aliasBase` joins tsconfig `paths` targets (always relative to a base).
  // `explicitBaseUrl` is only set when tsconfig declares `baseUrl`, which is the
  // only case where bare specifiers resolve against the base (matching tsc).
  const aliasBase = toPosix(cfg.baseUrl ?? ".");
  const explicitBaseUrl = cfg.baseUrl != null ? toPosix(cfg.baseUrl) : undefined;
  const aliases = Object.entries(cfg.paths ?? {});
  const workspaces = (cfg.workspaces ?? []).map((w) => ({
    name: w.name,
    dir: toPosix(w.dir),
    entry: w.entry ? toPosix(w.entry) : undefined,
  }));

  /** Try a base path against the file set with extension and index fallback. */
  const resolveCandidate = (candidate: string): string | null => {
    const base = toPosix(candidate);
    if (fileSet.has(base)) return base;
    for (const ext of EXTENSIONS) {
      const withExt = `${base}${ext}`;
      if (fileSet.has(withExt)) return withExt;
    }
    for (const idx of INDEX_FILES) {
      const withIndex = toPosix(path.posix.join(base, idx));
      if (fileSet.has(withIndex)) return withIndex;
    }
    return null;
  };

  /** Expand an alias specifier into candidate base paths (may be several). */
  const expandAliases = (specifier: string): string[] => {
    const candidates: string[] = [];
    for (const [pattern, targets] of aliases) {
      const star = pattern.indexOf("*");
      if (star === -1) {
        if (specifier !== pattern) continue;
        for (const t of targets) candidates.push(toPosix(path.posix.join(aliasBase, t)));
        continue;
      }
      const prefix = pattern.slice(0, star);
      const suffix = pattern.slice(star + 1);
      if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
      const matched = specifier.slice(prefix.length, specifier.length - suffix.length);
      for (const t of targets) {
        candidates.push(toPosix(path.posix.join(aliasBase, t.replace("*", matched))));
      }
    }
    return candidates;
  };

  return (fromRel, specifier) => {
    if (specifier.startsWith(".")) {
      const fromDir = path.posix.dirname(toPosix(fromRel));
      return resolveCandidate(path.posix.join(fromDir, specifier));
    }

    for (const candidate of expandAliases(specifier)) {
      const hit = resolveCandidate(candidate);
      if (hit) return hit;
    }

    // Monorepo workspace packages: `@acme/ui` -> its entry, `@acme/ui/x` -> dir/x.
    for (const ws of workspaces) {
      if (specifier === ws.name) {
        const bases = ws.entry ? [path.posix.join(ws.dir, ws.entry), ws.dir] : [ws.dir];
        for (const base of bases) {
          const hit = resolveCandidate(base);
          if (hit) return hit;
        }
      } else if (specifier.startsWith(`${ws.name}/`)) {
        const sub = specifier.slice(ws.name.length + 1);
        const hit = resolveCandidate(path.posix.join(ws.dir, sub));
        if (hit) return hit;
      }
    }

    // Bare specifier resolved against an explicit tsconfig baseUrl (tsc step 2).
    if (explicitBaseUrl !== undefined) {
      return resolveCandidate(path.posix.join(explicitBaseUrl, specifier));
    }

    return null;
  };
}
