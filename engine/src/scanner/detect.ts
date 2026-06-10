function basename(relPath: string): string {
  return relPath.split("/").pop() ?? relPath;
}

/**
 * Detect the project's tech stack from marker files and dependency manifests.
 * `readFile` is injected so this stays pure and testable; it returns file
 * contents for a repo-relative path, or null if unavailable.
 *
 * Returns a sorted, de-duplicated list of stack tags.
 */
export function detectStack(
  relPaths: string[],
  readFile: (relPath: string) => string | null,
): string[] {
  const tags = new Set<string>();
  const bases = relPaths.map(basename);
  const has = (name: string) => bases.includes(name);
  const hasExt = (exts: string[]) =>
    relPaths.some((p) => exts.some((e) => p.toLowerCase().endsWith(e)));

  // package.json dependencies (merged dev + prod).
  const pkgPath = relPaths.find((p) => basename(p) === "package.json");
  let deps: Record<string, unknown> = {};
  if (pkgPath) {
    const raw = readFile(pkgPath);
    if (raw) {
      try {
        const pkg = JSON.parse(raw) as {
          dependencies?: Record<string, unknown>;
          devDependencies?: Record<string, unknown>;
        };
        deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      } catch {
        // malformed package.json — ignore
      }
    }
  }
  const dep = (name: string) => name in deps;

  // Python dependency manifests.
  const reqPath = relPaths.find((p) => {
    const b = basename(p);
    return b === "requirements.txt" || b === "pyproject.toml";
  });
  const reqText = reqPath ? (readFile(reqPath) ?? "").toLowerCase() : "";

  if (hasExt([".ts", ".tsx"])) tags.add("typescript");
  if (dep("react")) tags.add("react");
  if (dep("express")) tags.add("express");
  if (dep("@nestjs/common") || dep("@nestjs/core")) tags.add("nest");
  if (dep("vite") || bases.some((b) => /^vite\.config\.(js|ts|mjs|cjs)$/.test(b))) {
    tags.add("vite");
  }
  if (dep("react-scripts")) tags.add("cra");
  if (dep("next") || bases.some((b) => /^next\.config\.(js|ts|mjs|cjs)$/.test(b))) {
    tags.add("next.js");
  }
  if (has("manage.py") || has("settings.py") || /django/.test(reqText)) {
    tags.add("django");
  }
  if (reqText.includes("fastapi")) tags.add("fastapi");
  if (/(^|[^a-z])flask/.test(reqText)) tags.add("flask");
  if (
    bases.some(
      (b) => b === "Dockerfile" || /^(docker-)?compose\.ya?ml$/.test(b.toLowerCase()),
    )
  ) {
    tags.add("docker");
  }

  return [...tags].sort();
}
