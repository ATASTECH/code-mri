import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { nodeId } from "../ids.js";
import { analyzeProject } from "./analyze.js";

const FIXTURE = fileURLToPath(new URL("../../test/fixtures/express-app", import.meta.url));

describe("analyzeProject — Express integration", () => {
  test("surfaces Express routes and endpoints in the report graph", async () => {
    const { report } = await analyzeProject(FIXTURE);
    const ids = new Set(report.nodes.map((n) => n.id));

    expect(ids.has(nodeId("Route", "src/routes/users.ts", "GET /users/{id}"))).toBe(true);
    expect(ids.has(nodeId("APIEndpoint", "GET /users/{id}"))).toBe(true);
    expect(ids.has(nodeId("Service", "src/app.ts", "app"))).toBe(true);
  });

  test("counts Express endpoints in the report summary", async () => {
    const { report } = await analyzeProject(FIXTURE);
    expect(report.summary.endpoints).toBeGreaterThanOrEqual(4);
  });
});
