import * as path from "node:path";
import { ts } from "ts-morph";

export interface TsResolverConfig {
  /** Repo-relative baseUrl, or undefined when tsconfig declares none. */
  baseUrl: string | undefined;
  /** tsconfig `paths` map (patterns → relative targets). */
  paths: Record<string, string[]>;
}

const CONFIG_NAMES = ["tsconfig.json", "jsconfig.json"];

/**
 * Read tsconfig/jsconfig path-alias config from a repo root for the module
 * resolver. Tolerates comments and `extends` via the TypeScript config parser.
 * Returns sensible defaults when no config is present.
 */
export function readTsResolverConfig(root: string): TsResolverConfig {
  for (const name of CONFIG_NAMES) {
    const file = path.join(root, name);
    const read = ts.readConfigFile(file, ts.sys.readFile);
    if (read.error || !read.config) continue;

    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root);
    const opts = parsed.options;
    let baseUrl: string | undefined;
    if (opts.baseUrl) {
      const rel = path.relative(root, opts.baseUrl).replace(/\\/g, "/");
      baseUrl = rel === "" ? "." : rel;
    }
    return { baseUrl, paths: opts.paths ?? {} };
  }

  return { baseUrl: undefined, paths: {} };
}
