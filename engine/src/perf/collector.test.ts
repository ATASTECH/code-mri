import { describe, expect, it } from "vitest";
import { createPerfCollector } from "./collector.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("createPerfCollector", () => {
  it("returns the value produced by a wrapped phase", async () => {
    const perf = createPerfCollector();

    const sync = await perf.phase("sync", () => 42);
    const async = await perf.phase("async", async () => {
      await delay(1);
      return "done";
    });

    expect(sync).toBe(42);
    expect(async).toBe("done");
  });

  it("records a phase name with a non-negative duration", async () => {
    const perf = createPerfCollector();

    await perf.phase("scan", () => delay(5));

    const { phases } = perf.snapshot();
    expect(phases).toHaveLength(1);
    const [scan] = phases;
    expect(scan?.name).toBe("scan");
    expect(scan?.ms ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("preserves phase order and totals their durations", async () => {
    const perf = createPerfCollector();

    await perf.phase("a", () => delay(2));
    await perf.phase("b", () => delay(2));

    const snap = perf.snapshot();
    expect(snap.phases.map((p) => p.name)).toEqual(["a", "b"]);
    const sum = snap.phases.reduce((acc, p) => acc + p.ms, 0);
    expect(snap.totalMs).toBeCloseTo(sum, 5);
  });

  it("tracks a positive peak RSS across samples", async () => {
    const perf = createPerfCollector();

    await perf.phase("work", () => delay(1));
    perf.sample();

    expect(perf.snapshot().peakRssBytes).toBeGreaterThan(0);
  });
});
