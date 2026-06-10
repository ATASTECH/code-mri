import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { createPerfCollector } from "../perf/collector.js";
import { analyzeProject } from "./analyze.js";
import { analyzeProjectRepos } from "./analyzeRepos.js";

const FIXTURE = fileURLToPath(new URL("../../test/fixtures/sample-app", import.meta.url));

describe("analyzeProject perf instrumentation", () => {
  test("records pipeline phases when a collector is supplied", async () => {
    const perf = createPerfCollector();

    await analyzeProject(FIXTURE, { perf });

    const snap = perf.snapshot();
    const names = snap.phases.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(["scan", "parse", "graph", "rules"]));
    expect(snap.totalMs).toBeGreaterThan(0);
    expect(snap.peakRssBytes).toBeGreaterThan(0);
  });

  test("stays a no-op (no throw, no phases) when no collector is supplied", async () => {
    const result = await analyzeProject(FIXTURE);
    expect(result.report.nodes.length).toBeGreaterThan(0);
  });
});

describe("analyzeProjectRepos perf and progress instrumentation", () => {
  test("records multi-repo phases and emits progress events", async () => {
    const perf = createPerfCollector();
    const progress: Array<{ phase: string; percent: number }> = [];

    await analyzeProjectRepos(
      {
        projectName: "Fixture",
        repos: [{ id: "app", name: "App", root: FIXTURE, role: "fullstack" }],
      },
      {
        perf,
        progress: (event) => progress.push({ phase: event.phase, percent: event.percent }),
      },
    );

    const names = perf.snapshot().phases.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(["repos", "link", "graph", "rules"]));
    expect(progress.at(0)).toMatchObject({ phase: "repos", percent: 0 });
    expect(progress.at(-1)).toMatchObject({ phase: "done", percent: 100 });
  });
});
