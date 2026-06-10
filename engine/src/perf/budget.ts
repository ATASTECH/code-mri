import type { PerfSnapshot } from "./collector.js";

export interface PerfBudget {
  maxTotalMs?: number;
  maxPeakRssBytes?: number;
}

export function assertPerfBudget(snapshot: PerfSnapshot, budget: PerfBudget): void {
  const failures: string[] = [];
  if (budget.maxTotalMs !== undefined && snapshot.totalMs > budget.maxTotalMs) {
    failures.push(
      `total ${Math.round(snapshot.totalMs)}ms exceeded ${Math.round(budget.maxTotalMs)}ms`,
    );
  }
  if (budget.maxPeakRssBytes !== undefined && snapshot.peakRssBytes > budget.maxPeakRssBytes) {
    const actual = Math.round(snapshot.peakRssBytes / 1024 / 1024);
    const limit = Math.round(budget.maxPeakRssBytes / 1024 / 1024);
    failures.push(`peak RSS ${actual}MB exceeded ${limit}MB`);
  }
  if (failures.length > 0) {
    throw new Error(`Performance budget exceeded: ${failures.join("; ")}`);
  }
}
