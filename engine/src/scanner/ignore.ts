import ignore from "ignore";

/** Directories/patterns we never want to analyze, regardless of .gitignore. */
const DEFAULT_IGNORES = [
  ".git/",
  "node_modules/",
  ".venv/",
  "venv/",
  "__pycache__/",
  ".next/",
  "dist/",
  "build/",
  "out/",
  "coverage/",
  ".turbo/",
  ".pytest_cache/",
  "*.pyc",
];

/**
 * Build a keep-predicate over repo-relative POSIX paths.
 * Returns `true` for paths that should be analyzed, `false` for ignored ones.
 * Extra patterns use .gitignore syntax (e.g. read from the repo's .gitignore).
 */
export function createIgnoreFilter(
  extraPatterns: string[] = [],
): (relPath: string) => boolean {
  const ig = ignore().add(DEFAULT_IGNORES).add(extraPatterns);
  return (relPath: string) => relPath.length > 0 && !ig.ignores(relPath);
}
