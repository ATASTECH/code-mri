import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { nodeId } from "../../ids.js";
import { scanRepo } from "../../scanner/scan.js";
import { analyzePython } from "./analyze.js";

const FASTAPI = fileURLToPath(new URL("../../../test/fixtures/fastapi-app", import.meta.url));
const FLASK = fileURLToPath(new URL("../../../test/fixtures/flask-app", import.meta.url));

async function analyze(fixture: string) {
  const scan = await scanRepo(fixture);
  const py = scan.files.filter((f) => f.category === "python").map((f) => f.path);
  return analyzePython(scan.root, py);
}

describe("analyzePython — FastAPI (spawns python sidecar)", () => {
  test("resolves include_router prefix + APIRouter prefix into full routes", async () => {
    const a = await analyze(FASTAPI);
    const paths = a.routes.map((r) => `${r.method} ${r.path}`).sort();
    expect(paths).toEqual(
      ["GET /api/users", "GET /api/users/{user_id}", "GET /health", "POST /api/users"].sort(),
    );
  });

  test("emits an APIEndpoint and a router Service node", async () => {
    const a = await analyze(FASTAPI);
    const ids = new Set(a.nodes.map((n) => n.id));
    expect(ids.has(nodeId("APIEndpoint", "GET /api/users/{user_id}"))).toBe(true);
    expect(ids.has(nodeId("Service", "main.py", "router"))).toBe(true);
  });

  test("extracts Pydantic BaseModel as a Model with annotated fields", async () => {
    const a = await analyze(FASTAPI);
    const ids = new Set(a.nodes.map((n) => n.id));
    expect(ids.has(nodeId("Model", "schemas.py", "User"))).toBe(true);
    expect(ids.has(nodeId("Field", "schemas.py", "User", "email"))).toBe(true);
  });

  test("attaches Pydantic response model fields to FastAPI routes", async () => {
    const a = await analyze(FASTAPI);
    const list = a.routes.find((r) => r.method === "GET" && r.path === "/api/users");
    expect(list?.responseFields).toEqual(
      expect.arrayContaining([
        { id: nodeId("Field", "schemas.py", "User", "email"), name: "email" },
        { id: nodeId("Field", "schemas.py", "User", "name"), name: "name" },
      ]),
    );
  });
});

describe("analyzePython — Flask (spawns python sidecar)", () => {
  test("resolves blueprint url_prefix + register_blueprint prefix; <int:id> → {id}", async () => {
    const a = await analyze(FLASK);
    const paths = a.routes.map((r) => `${r.method} ${r.path}`).sort();
    expect(paths).toEqual(
      ["GET /api/users", "GET /api/users/{user_id}", "GET /health", "POST /api/users"].sort(),
    );
  });
});
