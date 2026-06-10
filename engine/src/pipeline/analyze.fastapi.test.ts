import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { nodeId } from "../ids.js";
import { analyzeProject } from "./analyze.js";

const FASTAPI = fileURLToPath(new URL("../../test/fixtures/fastapi-app", import.meta.url));

describe("analyzeProject — FastAPI integration", () => {
  test("surfaces FastAPI routes and endpoints and detects the stack", async () => {
    const { report, scan } = await analyzeProject(FASTAPI);
    const ids = new Set(report.nodes.map((n) => n.id));
    expect(scan.stack).toContain("fastapi");
    expect(ids.has(nodeId("APIEndpoint", "GET /api/users/{user_id}"))).toBe(true);
    expect(ids.has(nodeId("Service", "main.py", "router"))).toBe(true);
    expect(report.summary.endpoints).toBeGreaterThanOrEqual(4);
  });
});
