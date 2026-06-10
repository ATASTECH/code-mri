import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { nodeId } from "../ids.js";
import { analyzeProject } from "./analyze.js";

const FIXTURE = fileURLToPath(new URL("../../test/fixtures/nest-app", import.meta.url));

describe("analyzeProject — NestJS integration", () => {
  test("surfaces Nest routes, endpoints and services in the report graph", async () => {
    const { report } = await analyzeProject(FIXTURE);
    const ids = new Set(report.nodes.map((n) => n.id));

    expect(ids.has(nodeId("Route", "src/users/users.controller.ts", "GET /users/{id}"))).toBe(true);
    expect(ids.has(nodeId("APIEndpoint", "GET /users/{id}"))).toBe(true);
    expect(ids.has(nodeId("Service", "src/users/users.controller.ts", "UsersController"))).toBe(true);
  });

  test("counts Nest endpoints in the report summary", async () => {
    const { report } = await analyzeProject(FIXTURE);
    expect(report.summary.endpoints).toBeGreaterThanOrEqual(3);
  });
});
