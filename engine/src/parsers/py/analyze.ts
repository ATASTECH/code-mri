import { buildBackendGraph, type PyAnalysis } from "./assemble.js";
import { type PyCache, pyFilesDigest } from "./cache.js";
import { runSidecar, type SidecarOptions } from "./sidecar.js";

/**
 * Analyze the Django/DRF side of a repo: spawn the Python `ast` sidecar over the
 * given python files (repo-relative paths) and assemble graph nodes/edges plus
 * canonical API routes.
 *
 * When a `cache` is supplied and no `.py` file changed (same content digest),
 * the cached analysis is returned and the sidecar is not spawned at all.
 */
export async function analyzePython(
  root: string,
  pyFiles: string[],
  opts?: SidecarOptions,
  cache?: PyCache,
): Promise<PyAnalysis> {
  if (!cache) {
    return buildBackendGraph(await runSidecar(root, pyFiles, opts));
  }

  const digest = pyFilesDigest(root, pyFiles);
  const cached = cache.get(digest);
  if (cached) return cached;

  const analysis = buildBackendGraph(await runSidecar(root, pyFiles, opts));
  cache.set(digest, analysis);
  return analysis;
}
