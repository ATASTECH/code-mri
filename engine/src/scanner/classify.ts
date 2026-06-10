export type FileCategory =
  | "typescript"
  | "python"
  | "docker"
  | "env"
  | "config"
  | "other";

const TS_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const CONFIG_EXTS = new Set([".json", ".toml", ".yaml", ".yml", ".ini", ".cfg"]);

function basename(relPath: string): string {
  return relPath.split("/").pop() ?? relPath;
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

/** Single-category classification of a repo-relative file path. */
export function classifyFile(relPath: string): FileCategory {
  const base = basename(relPath);
  const lower = base.toLowerCase();

  // Docker, matched by name before generic yaml config.
  if (lower === "dockerfile" || lower.startsWith("dockerfile.")) return "docker";
  if (/^(docker-)?compose\.ya?ml$/.test(lower)) return "docker";

  // Env files (.env, .env.example, .env.local, ...).
  if (lower === ".env" || lower.startsWith(".env")) return "env";

  const ext = extOf(lower);
  if (TS_EXTS.has(ext)) return "typescript";
  if (ext === ".py") return "python";
  if (CONFIG_EXTS.has(ext)) return "config";
  return "other";
}
