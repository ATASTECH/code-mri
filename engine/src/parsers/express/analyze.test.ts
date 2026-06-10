import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { nodeId } from "../../ids.js";
import { scanRepo } from "../../scanner/scan.js";
import { analyzeExpress } from "./analyze.js";

const FIXTURE = fileURLToPath(
  new URL("../../../test/fixtures/express-app", import.meta.url),
);

async function analyzeFixture() {
  const scan = await scanRepo(FIXTURE);
  const tsFiles = scan.files.filter((f) => f.category === "typescript");
  return analyzeExpress(scan.root, tsFiles);
}

describe("analyzeExpress (golden fixture)", () => {
  test("creates Service nodes for the app and the router", async () => {
    const a = await analyzeFixture();
    const byId = new Map(a.nodes.map((n) => [n.id, n]));

    const app = byId.get(nodeId("Service", "src/app.ts", "app"));
    expect(app?.meta).toMatchObject({ framework: "express", type: "app" });

    const router = byId.get(nodeId("Service", "src/routes/users.ts", "usersRouter"));
    expect(router?.meta).toMatchObject({ framework: "express", type: "router" });
  });

  test("composes the mounted prefix into full route paths", async () => {
    const a = await analyzeFixture();
    const routePaths = a.routes
      .map((r) => `${r.method} ${r.path}`)
      .sort();
    expect(routePaths).toEqual(
      [
        "GET /health",
        "GET /users",
        "GET /users/{id}",
        "POST /users",
      ].sort(),
    );
  });

  test("exposes an APIEndpoint per route and links it with EXPOSES", async () => {
    const a = await analyzeFixture();
    const endpointId = nodeId("APIEndpoint", "GET /users/{id}");
    expect(a.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: endpointId,
          kind: "APIEndpoint",
          meta: expect.objectContaining({ method: "GET", path: "/users/{id}", source: "express" }),
        }),
      ]),
    );
    const routeId = nodeId("Route", "src/routes/users.ts", "GET /users/{id}");
    expect(
      a.edges.some((e) => e.kind === "EXPOSES" && e.from === routeId && e.to === endpointId),
    ).toBe(true);
  });

  test("registers the child router into the app with REGISTERED_IN", async () => {
    const a = await analyzeFixture();
    const child = nodeId("Service", "src/routes/users.ts", "usersRouter");
    const parent = nodeId("Service", "src/app.ts", "app");
    expect(
      a.edges.some((e) => e.kind === "REGISTERED_IN" && e.from === child && e.to === parent),
    ).toBe(true);
  });

  test("links a route to its named handler with USES", async () => {
    const a = await analyzeFixture();
    const routeId = nodeId("Route", "src/routes/users.ts", "GET /users");
    const handlerId = nodeId("Function", "src/routes/users.ts", "listUsers");
    expect(
      a.edges.some((e) => e.kind === "USES" && e.from === routeId && e.to === handlerId),
    ).toBe(true);
  });
});
