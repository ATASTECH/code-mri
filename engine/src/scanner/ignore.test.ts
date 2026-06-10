import { describe, expect, test } from "vitest";
import { createIgnoreFilter } from "./ignore.js";

describe("createIgnoreFilter", () => {
  test("ignores common build/dependency dirs by default", () => {
    const keep = createIgnoreFilter();
    expect(keep("node_modules/react/index.js")).toBe(false);
    expect(keep("backend/.venv/lib/x.py")).toBe(false);
    expect(keep("app/__pycache__/x.pyc")).toBe(false);
    expect(keep("frontend/.next/build.js")).toBe(false);
    expect(keep("engine/dist/index.js")).toBe(false);
  });

  test("keeps normal source files", () => {
    const keep = createIgnoreFilter();
    expect(keep("frontend/pages/users.tsx")).toBe(true);
    expect(keep("backend/users/models.py")).toBe(true);
  });

  test("honors extra patterns (gitignore syntax)", () => {
    const keep = createIgnoreFilter(["*.log", "secret/"]);
    expect(keep("debug.log")).toBe(false);
    expect(keep("secret/key.txt")).toBe(false);
    expect(keep("src/app.ts")).toBe(true);
  });
});
