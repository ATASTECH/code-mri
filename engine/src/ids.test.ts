import { describe, expect, test } from "vitest";
import { nodeId, edgeId } from "./ids.js";

describe("nodeId", () => {
  test("builds a kind-prefixed id from a single part", () => {
    expect(nodeId("File", "apps/web/users.tsx")).toBe("File:apps/web/users.tsx");
  });

  test("joins multiple parts with a member separator", () => {
    expect(nodeId("Component", "apps/web/UserTable.tsx", "UserTable")).toBe(
      "Component:apps/web/UserTable.tsx#UserTable",
    );
    expect(nodeId("Field", "backend/users/models.py", "User", "email")).toBe(
      "Field:backend/users/models.py#User#email",
    );
  });

  test("is deterministic for the same inputs", () => {
    expect(nodeId("Model", "m.py", "User")).toBe(nodeId("Model", "m.py", "User"));
  });
});

describe("edgeId", () => {
  test("encodes kind, source and target so identical edges dedupe", () => {
    expect(edgeId("IMPORTS", "File:a.ts", "File:b.ts")).toBe(
      "IMPORTS:File:a.ts->File:b.ts",
    );
  });

  test("differs by kind for the same endpoints", () => {
    expect(edgeId("USES", "A", "B")).not.toBe(edgeId("CALLS", "A", "B"));
  });
});
