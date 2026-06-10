import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { scanRepo } from "./scan.js";

const FIXTURE = fileURLToPath(
  new URL("../../test/fixtures/sample-app", import.meta.url),
);

describe("scanRepo (golden fixture)", () => {
  test("detects the full stack", async () => {
    const result = await scanRepo(FIXTURE);
    expect(result.stack).toEqual(
      expect.arrayContaining(["django", "docker", "next.js", "react", "typescript"]),
    );
  });

  test("returns repo-relative POSIX paths with categories", async () => {
    const result = await scanRepo(FIXTURE);
    const byPath = new Map(result.files.map((f) => [f.path, f]));

    expect(byPath.get("backend/users/models.py")?.category).toBe("python");
    expect(byPath.get("frontend/pages/users.tsx")?.category).toBe("typescript");
    expect(byPath.get("docker-compose.yml")?.category).toBe("docker");
  });

  test("never emits ignored or absolute paths, and is sorted", async () => {
    const result = await scanRepo(FIXTURE);
    const paths = result.files.map((f) => f.path);

    expect(paths.some((p) => p.includes("node_modules"))).toBe(false);
    expect(paths.some((p) => p.startsWith("/"))).toBe(false);
    expect(paths).toEqual([...paths].sort());
  });
});
