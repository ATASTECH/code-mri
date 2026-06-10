import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { scanRepo } from "../scanner/scan.js";
import { runAnalyzers } from "./registry.js";
import type { AnalyzeContext } from "./types.js";

const EXPRESS = fileURLToPath(new URL("../../test/fixtures/express-app", import.meta.url));
const NEST = fileURLToPath(new URL("../../test/fixtures/nest-app", import.meta.url));
const DJANGO_NEXT = fileURLToPath(new URL("../../test/fixtures/sample-app", import.meta.url));

async function context(fixture: string): Promise<AnalyzeContext> {
  const scan = await scanRepo(fixture);
  return { scan, options: {} };
}

describe("runAnalyzers (unified registry)", () => {
  test("runs the Express analyzer when express is detected, not Nest", async () => {
    const result = await runAnalyzers(await context(EXPRESS));
    expect(result.routes.some((r) => r.path === "/users/{id}")).toBe(true);
    expect(result.nodes.every((n) => n.meta?.framework !== "nest")).toBe(true);
  });

  test("runs the Nest analyzer when @nestjs is detected", async () => {
    const result = await runAnalyzers(await context(NEST));
    expect(result.nodes.some((n) => n.meta?.framework === "nest")).toBe(true);
  });

  test("runs the core TS + Python analyzers through the same registry", async () => {
    const result = await runAnalyzers(await context(DJANGO_NEXT));
    // Python (Django) backend routes flow through the registry...
    expect(result.routes.some((r) => r.method === "GET" && r.path === "/api/users/")).toBe(true);
    // ...and TS frontend api calls become linker inputs.
    expect(result.apiCalls.length).toBeGreaterThan(0);
    // No web-framework analyzer applies to this Next.js + Django project.
    expect(result.nodes.every((n) => n.meta?.framework !== "express")).toBe(true);
  });

  test("only runs detected analyzers (no Express nodes in a Nest project)", async () => {
    const result = await runAnalyzers(await context(NEST));
    expect(result.nodes.every((n) => n.meta?.framework !== "express")).toBe(true);
  });
});
