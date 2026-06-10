import { describe, expect, test } from "vitest";
import type { PerfSnapshot } from "./collector.js";
import { assertPerfBudget } from "./budget.js";

const snapshot: PerfSnapshot = {
  phases: [{ name: "scan", ms: 10 }],
  totalMs: 20,
  peakRssBytes: 50 * 1024 * 1024,
};

describe("assertPerfBudget", () => {
  test("passes when totals are inside the budget", () => {
    expect(() =>
      assertPerfBudget(snapshot, {
        maxTotalMs: 25,
        maxPeakRssBytes: 64 * 1024 * 1024,
      }),
    ).not.toThrow();
  });

  test("throws with actionable budget failures", () => {
    expect(() =>
      assertPerfBudget(snapshot, {
        maxTotalMs: 10,
        maxPeakRssBytes: 16 * 1024 * 1024,
      }),
    ).toThrow(/total 20ms exceeded 10ms.*peak RSS 50MB exceeded 16MB/);
  });
});
