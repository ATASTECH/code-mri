/**
 * Lightweight performance collector for the engine pipeline.
 *
 * Wraps pipeline phases to record wall-clock duration and sample peak RSS.
 * When no collector is passed into the pipeline there is zero overhead — the
 * pipeline simply never calls into it.
 */

export interface PhaseTiming {
  name: string;
  ms: number;
}

export interface PerfSnapshot {
  phases: PhaseTiming[];
  totalMs: number;
  peakRssBytes: number;
}

export interface PerfCollector {
  /** Run `fn`, recording its duration under `name`. Returns the fn result. */
  phase<T>(name: string, fn: () => T | Promise<T>): Promise<T>;
  /** Record current RSS, updating the tracked peak. */
  sample(): void;
  /** Immutable view of collected timings and peak memory. */
  snapshot(): PerfSnapshot;
}

export function createPerfCollector(): PerfCollector {
  const phases: PhaseTiming[] = [];
  let peakRssBytes = 0;

  const sample = (): void => {
    const rss = process.memoryUsage().rss;
    if (rss > peakRssBytes) peakRssBytes = rss;
  };

  // Baseline sample so peak is meaningful even before any phase runs.
  sample();

  const phase = async <T>(name: string, fn: () => T | Promise<T>): Promise<T> => {
    sample();
    const start = performance.now();
    try {
      return await fn();
    } finally {
      const ms = performance.now() - start;
      phases.push({ name, ms });
      sample();
    }
  };

  const snapshot = (): PerfSnapshot => ({
    phases: phases.map((p) => ({ ...p })),
    totalMs: phases.reduce((acc, p) => acc + p.ms, 0),
    peakRssBytes,
  });

  return { phase, sample, snapshot };
}
