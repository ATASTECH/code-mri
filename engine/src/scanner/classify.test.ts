import { describe, expect, test } from "vitest";
import { classifyFile } from "./classify.js";

describe("classifyFile", () => {
  test("classifies TypeScript/JS source", () => {
    expect(classifyFile("frontend/pages/users.tsx")).toBe("typescript");
    expect(classifyFile("frontend/lib/api.ts")).toBe("typescript");
    expect(classifyFile("a/b/c.jsx")).toBe("typescript");
    expect(classifyFile("next.config.mjs")).toBe("typescript");
  });

  test("classifies Python source", () => {
    expect(classifyFile("backend/users/models.py")).toBe("python");
  });

  test("classifies Docker files (by name, before yaml config)", () => {
    expect(classifyFile("docker-compose.yml")).toBe("docker");
    expect(classifyFile("backend/Dockerfile")).toBe("docker");
    expect(classifyFile("compose.yaml")).toBe("docker");
  });

  test("classifies env files", () => {
    expect(classifyFile(".env")).toBe("env");
    expect(classifyFile(".env.example")).toBe("env");
  });

  test("classifies remaining config files", () => {
    expect(classifyFile("frontend/package.json")).toBe("config");
    expect(classifyFile("backend/pyproject.toml")).toBe("config");
    expect(classifyFile("service.yml")).toBe("config");
  });

  test("falls back to 'other'", () => {
    expect(classifyFile("README.md")).toBe("other");
    expect(classifyFile("logo.png")).toBe("other");
  });
});
