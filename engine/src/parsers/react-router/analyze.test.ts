import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { nodeId } from "../../ids.js";
import { scanRepo } from "../../scanner/scan.js";
import { analyzeReactRouter, findEntryPoint } from "./analyze.js";

const FIXTURE = fileURLToPath(new URL("../../../test/fixtures/vite-app", import.meta.url));

async function analyzeFixture() {
  const scan = await scanRepo(FIXTURE);
  const tsFiles = scan.files
    .filter((f) => f.category === "typescript")
    .map((f) => ({ path: f.path, abs: f.abs }));
  return { result: analyzeReactRouter(scan.root, tsFiles), files: tsFiles.map((f) => f.path) };
}

describe("analyzeReactRouter (golden fixture)", () => {
  test("turns <Route> elements into page Route nodes with normalized paths", async () => {
    const { result } = await analyzeFixture();
    const paths = result.nodes
      .filter((n) => n.kind === "Route")
      .map((n) => n.meta?.path)
      .sort();
    expect(paths).toEqual(["/", "/users", "/users/{id}"]);
  });

  test("links each route to the page component it renders", async () => {
    const { result } = await analyzeFixture();
    const routeId = nodeId("Route", "src/App.tsx", "PAGE /users/{id}");
    const comp = nodeId("Component", "src/pages/UserDetailPage.tsx", "UserDetailPage");
    expect(
      result.edges.some((e) => e.kind === "RENDERS" && e.from === routeId && e.to === comp),
    ).toBe(true);
  });

  test("does not contribute backend routes", async () => {
    const { result } = await analyzeFixture();
    expect(result.routes).toEqual([]);
  });

  test("finds the Vite entry point", async () => {
    const { files } = await analyzeFixture();
    expect(findEntryPoint(files)).toBe("src/main.tsx");
  });
});
