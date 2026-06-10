import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { nodeId } from "../ids.js";
import { analyzeProject } from "./analyze.js";

const VITE = fileURLToPath(new URL("../../test/fixtures/vite-app", import.meta.url));

describe("analyzeProject — Vite + react-router integration", () => {
  test("detects the stack and maps page routes to their components", async () => {
    const { report, scan } = await analyzeProject(VITE);
    const ids = new Set(report.nodes.map((n) => n.id));

    expect(scan.stack).toContain("vite");
    const routeId = nodeId("Route", "src/App.tsx", "PAGE /users/{id}");
    const comp = nodeId("Component", "src/pages/UserDetailPage.tsx", "UserDetailPage");
    expect(ids.has(routeId)).toBe(true);
    expect(report.edges.some((e) => e.kind === "RENDERS" && e.from === routeId && e.to === comp)).toBe(
      true,
    );
  });
});
