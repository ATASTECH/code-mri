import { describe, expect, test } from "vitest";
import type { Report } from "@code-mri/shared-types";
import { nodeId } from "../ids.js";
import { diffReports } from "./reportDiff.js";

function baseReport(overrides: Partial<Report> = {}): Report {
  return {
    schemaVersion: 4,
    project: { name: "demo", stack: [], root: "/repo" },
    summary: { files: 1, components: 0, models: 0, endpoints: 0 },
    nodes: [],
    edges: [],
    issues: [],
    scores: { health: 100, breakdown: {} },
    ...overrides,
  };
}

describe("diffReports", () => {
  test("detects graph deltas and breaking endpoint/field changes", () => {
    const endpoint = nodeId("APIEndpoint", "GET /api/users/");
    const postEndpoint = nodeId("APIEndpoint", "POST /api/users/");
    const field = nodeId("Field", "api/models.py", "User", "email");
    const serializer = nodeId("Serializer", "api/serializers.py", "UserSerializer");

    const before = baseReport({
      nodes: [
        {
          id: endpoint,
          kind: "APIEndpoint",
          name: "GET /api/users/",
          meta: { method: "GET", path: "/api/users/" },
        },
        {
          id: field,
          kind: "Field",
          name: "email",
          loc: { file: "api/models.py", line: 3 },
        },
        {
          id: serializer,
          kind: "Serializer",
          name: "UserSerializer",
          loc: { file: "api/serializers.py", line: 2 },
        },
      ],
      edges: [
        {
          id: "USES:serializer-field",
          kind: "USES",
          from: serializer,
          to: field,
        },
      ],
    });
    const after = baseReport({
      scores: { health: 90, breakdown: { DANGLING_API_CALL: 0 } },
      nodes: [
        {
          id: postEndpoint,
          kind: "APIEndpoint",
          name: "POST /api/users/",
          meta: { method: "POST", path: "/api/users/" },
        },
        {
          id: serializer,
          kind: "Serializer",
          name: "UserSerializer",
          loc: { file: "api/serializers.py", line: 2 },
        },
      ],
      issues: [
        {
          kind: "DANGLING_API_CALL",
          severity: "info",
          message: "GET /api/users/ has no backend endpoint",
          nodes: [],
          meta: { method: "GET", url: "/api/users/" },
        },
      ],
    });

    const diff = diffReports(before, after);

    expect(diff.summary.healthDelta).toBe(-10);
    expect(diff.summary.nodesAdded).toBe(1);
    expect(diff.summary.nodesRemoved).toBe(2);
    expect(diff.breakingChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "BREAKING_ENDPOINT_REMOVED" }),
        expect.objectContaining({ kind: "BREAKING_ROUTE_METHOD_CHANGED" }),
        expect.objectContaining({ kind: "BREAKING_FIELD_REMOVED" }),
      ]),
    );
  });

  test("keeps missing schemaVersion as a tolerated old report", () => {
    const before = baseReport();
    delete before.schemaVersion;
    const after = baseReport();

    expect(diffReports(before, after).summary.beforeSchemaVersion).toBeNull();
    expect(diffReports(before, after).summary.afterSchemaVersion).toBe(4);
  });
});
