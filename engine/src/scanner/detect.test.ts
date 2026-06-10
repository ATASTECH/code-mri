import { describe, expect, test } from "vitest";
import { detectStack } from "./detect.js";

describe("detectStack", () => {
  test("detects a Next.js + Django + Docker stack", () => {
    const paths = [
      "frontend/package.json",
      "frontend/pages/users.tsx",
      "backend/manage.py",
      "backend/users/models.py",
      "docker-compose.yml",
    ];
    const read = (p: string): string | null =>
      p === "frontend/package.json"
        ? JSON.stringify({ dependencies: { next: "14", react: "18" } })
        : null;

    expect(detectStack(paths, read)).toEqual([
      "django",
      "docker",
      "next.js",
      "react",
      "typescript",
    ]);
  });

  test("detects django via requirements when manage.py is absent", () => {
    const paths = ["api/requirements.txt", "api/app.py"];
    const read = (p: string): string | null =>
      p === "api/requirements.txt" ? "Django==5.0\ndjangorestframework==3.15\n" : null;
    expect(detectStack(paths, read)).toContain("django");
  });

  test("returns empty for an unrecognized project", () => {
    expect(detectStack(["main.go", "go.mod"], () => null)).toEqual([]);
  });

  test("detects Express from the express dependency", () => {
    const read = () => JSON.stringify({ dependencies: { express: "^4.19.0" } });
    expect(detectStack(["package.json", "src/app.ts"], read)).toContain("express");
  });

  test("detects NestJS from the @nestjs/common dependency", () => {
    const read = () => JSON.stringify({ dependencies: { "@nestjs/common": "^10.0.0" } });
    expect(detectStack(["package.json", "src/app.ts"], read)).toContain("nest");
  });

  test("detects FastAPI from requirements", () => {
    const read = (p: string) => (p === "requirements.txt" ? "fastapi==0.110.0\n" : null);
    expect(detectStack(["requirements.txt", "main.py"], read)).toContain("fastapi");
  });

  test("detects Flask from requirements", () => {
    const read = (p: string) => (p === "requirements.txt" ? "Flask==3.0.0\n" : null);
    expect(detectStack(["requirements.txt", "app.py"], read)).toContain("flask");
  });

  test("detects Vite from the vite devDependency", () => {
    const read = () => JSON.stringify({ devDependencies: { vite: "^5.2.0" } });
    expect(detectStack(["package.json", "src/main.tsx"], read)).toContain("vite");
  });

  test("detects Vite from a vite.config file", () => {
    expect(detectStack(["vite.config.ts", "src/main.tsx"], () => null)).toContain("vite");
  });

  test("detects CRA from react-scripts", () => {
    const read = () => JSON.stringify({ dependencies: { "react-scripts": "5.0.1" } });
    expect(detectStack(["package.json", "src/index.tsx"], read)).toContain("cra");
  });
});
