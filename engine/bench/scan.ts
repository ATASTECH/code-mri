#!/usr/bin/env tsx
/**
 * Engine scan benchmark harness.
 *
 *   pnpm bench [path] [--repeat N] [--python <bin>] [--openapi <file>] [--json]
 *
 * Runs `analyzeProject` against a target repo, recording per-phase wall-clock
 * time and peak RSS via the engine PerfCollector. Defaults to the bundled
 * sample-app fixture. With `--json` it prints a machine-readable summary so the
 * numbers can be diffed across runs / asserted in CI later.
 */
import { fileURLToPath } from "node:url";
import { createDiskFactsCache } from "../src/parsers/ts/cache.js";
import { analyzeProject } from "../src/pipeline/analyze.js";
import { createPerfCollector, type PerfSnapshot } from "../src/perf/collector.js";
import { assertPerfBudget } from "../src/perf/budget.js";

interface BenchArgs {
  target: string;
  repeat: number;
  python?: string;
  openapi?: string;
  cache?: string;
  incremental?: string;
  maxTotalMs?: number;
  maxRssMb?: number;
  json: boolean;
}

function parseArgs(argv: string[]): BenchArgs {
  const defaultTarget = fileURLToPath(
    new URL("../test/fixtures/sample-app", import.meta.url),
  );
  const args: BenchArgs = { target: defaultTarget, repeat: 1, json: false };
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === "--repeat") args.repeat = Math.max(1, Number(argv[++i]) || 1);
    else if (arg === "--python") args.python = argv[++i];
    else if (arg === "--openapi") args.openapi = argv[++i];
    else if (arg === "--cache") args.cache = argv[++i];
    else if (arg === "--incremental") args.incremental = argv[++i];
    else if (arg === "--max-total-ms") args.maxTotalMs = Number(argv[++i]);
    else if (arg === "--max-rss-mb") args.maxRssMb = Number(argv[++i]);
    else if (arg === "--json") args.json = true;
    else positional.push(arg);
  }

  if (positional[0]) args.target = positional[0];
  return args;
}

const mb = (bytes: number): number => Math.round((bytes / 1024 / 1024) * 10) / 10;
const ms = (value: number): number => Math.round(value * 10) / 10;

function aggregate(runs: PerfSnapshot[]): PerfSnapshot {
  const byPhase = new Map<string, number>();
  let totalMs = 0;
  let peakRssBytes = 0;
  for (const run of runs) {
    totalMs += run.totalMs;
    peakRssBytes = Math.max(peakRssBytes, run.peakRssBytes);
    for (const phase of run.phases) {
      byPhase.set(phase.name, (byPhase.get(phase.name) ?? 0) + phase.ms);
    }
  }
  const n = runs.length;
  return {
    phases: [...byPhase].map(([name, total]) => ({ name, ms: total / n })),
    totalMs: totalMs / n,
    peakRssBytes,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const runs: PerfSnapshot[] = [];
  let fileCount = 0;

  const cache = args.cache ? createDiskFactsCache(args.cache) : undefined;

  for (let i = 0; i < args.repeat; i++) {
    const perf = createPerfCollector();
    const result = await analyzeProject(args.target, {
      perf,
      cache,
      incrementalDir: args.incremental,
      python: args.python,
      openapi: args.openapi,
    });
    fileCount = result.report.summary.files;
    runs.push(perf.snapshot());
  }

  cache?.flush();

  const avg = aggregate(runs);
  assertPerfBudget(avg, {
    maxTotalMs: args.maxTotalMs,
    maxPeakRssBytes: args.maxRssMb === undefined ? undefined : args.maxRssMb * 1024 * 1024,
  });

  if (args.json) {
    console.log(
      JSON.stringify(
        { target: args.target, repeat: args.repeat, fileCount, ...avg },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`\ncode-mri scan benchmark`);
  console.log(`  target : ${args.target}`);
  console.log(`  files  : ${fileCount}`);
  console.log(`  repeat : ${args.repeat} (avg below)\n`);
  console.log(`  phase        ms`);
  console.log(`  ---------- -----`);
  for (const phase of avg.phases) {
    console.log(`  ${phase.name.padEnd(10)} ${ms(phase.ms).toString().padStart(5)}`);
  }
  console.log(`  ---------- -----`);
  console.log(`  ${"total".padEnd(10)} ${ms(avg.totalMs).toString().padStart(5)}`);
  console.log(`\n  peak RSS : ${mb(avg.peakRssBytes)} MB`);
  if (cache) {
    const s = cache.stats();
    console.log(`  cache    : ${s.hits} hits / ${s.misses} misses (${s.size} entries)`);
  }
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
