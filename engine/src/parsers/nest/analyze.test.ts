import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { nodeId } from "../../ids.js";
import { scanRepo } from "../../scanner/scan.js";
import { analyzeNest } from "./analyze.js";

const FIXTURE = fileURLToPath(
  new URL("../../../test/fixtures/nest-app", import.meta.url),
);

async function analyzeFixture() {
  const scan = await scanRepo(FIXTURE);
  const tsFiles = scan.files.filter((f) => f.category === "typescript");
  return analyzeNest(scan.root, tsFiles);
}

const CONTROLLER = nodeId("Service", "src/users/users.controller.ts", "UsersController");
const SERVICE = nodeId("Service", "src/users/users.service.ts", "UsersService");
const MODULE = nodeId("Service", "src/users/users.module.ts", "UsersModule");

describe("analyzeNest (golden fixture)", () => {
  test("creates Service nodes for controller, provider and module", async () => {
    const a = await analyzeFixture();
    const byId = new Map(a.nodes.map((n) => [n.id, n]));
    expect(byId.get(CONTROLLER)?.meta).toMatchObject({ framework: "nest", type: "controller" });
    expect(byId.get(SERVICE)?.meta).toMatchObject({ framework: "nest", type: "provider" });
    expect(byId.get(MODULE)?.meta).toMatchObject({ framework: "nest", type: "module" });
  });

  test("composes controller prefix with method decorator path", async () => {
    const a = await analyzeFixture();
    const routePaths = a.routes.map((r) => `${r.method} ${r.path}`).sort();
    expect(routePaths).toEqual(["GET /users", "GET /users/{id}", "POST /users"].sort());
  });

  test("exposes an APIEndpoint per route and links it with EXPOSES", async () => {
    const a = await analyzeFixture();
    const endpointId = nodeId("APIEndpoint", "GET /users/{id}");
    const routeId = nodeId("Route", "src/users/users.controller.ts", "GET /users/{id}");
    expect(a.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: endpointId,
          kind: "APIEndpoint",
          meta: expect.objectContaining({ method: "GET", path: "/users/{id}", source: "nest" }),
        }),
      ]),
    );
    expect(
      a.edges.some((e) => e.kind === "EXPOSES" && e.from === routeId && e.to === endpointId),
    ).toBe(true);
  });

  test("registers controller and provider into the module", async () => {
    const a = await analyzeFixture();
    const has = (from: string, to: string) =>
      a.edges.some((e) => e.kind === "REGISTERED_IN" && e.from === from && e.to === to);
    expect(has(CONTROLLER, MODULE)).toBe(true);
    expect(has(SERVICE, MODULE)).toBe(true);
  });

  test("links controller to its injected provider with DEPENDS_ON", async () => {
    const a = await analyzeFixture();
    expect(
      a.edges.some((e) => e.kind === "DEPENDS_ON" && e.from === CONTROLLER && e.to === SERVICE),
    ).toBe(true);
  });
});
