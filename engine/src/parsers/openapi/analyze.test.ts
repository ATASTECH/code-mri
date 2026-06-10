import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { nodeId } from "../../ids.js";
import { analyzeOpenApiSpec } from "./analyze.js";

const ROOT = fileURLToPath(new URL("../../../test/fixtures", import.meta.url));

describe("analyzeOpenApiSpec", () => {
  test("turns OpenAPI paths into APIEndpoint nodes and routes", () => {
    const analysis = analyzeOpenApiSpec(ROOT, "openapi.yaml");

    expect(analysis.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: nodeId("APIEndpoint", "GET /api/users/{id}/"),
          kind: "APIEndpoint",
          loc: { file: "openapi.yaml" },
          meta: expect.objectContaining({
            operationId: "getUser",
            source: "openapi",
          }),
        }),
      ]),
    );
    expect(analysis.routes).toEqual(
      expect.arrayContaining([
        {
          method: "GET",
          path: "/api/users/{id}/",
          viewsetId: null,
          endpointId: nodeId("APIEndpoint", "GET /api/users/{id}/"),
        },
      ]),
    );
  });
});
