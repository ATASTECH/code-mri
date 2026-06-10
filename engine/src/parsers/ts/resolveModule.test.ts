import { describe, expect, it } from "vitest";
import { createModuleResolver } from "./resolveModule.js";

const files = [
  "components/UserTable.tsx",
  "hooks/useUsers.ts",
  "lib/index.ts",
  "pages/users.tsx",
  "src/utils/format.ts",
];

describe("createModuleResolver", () => {
  it("resolves a relative import with extension fallback", () => {
    const resolve = createModuleResolver({ files });
    expect(resolve("pages/users.tsx", "../components/UserTable")).toBe(
      "components/UserTable.tsx",
    );
  });

  it("resolves a relative import to an index file", () => {
    const resolve = createModuleResolver({ files });
    expect(resolve("pages/users.tsx", "../lib")).toBe("lib/index.ts");
  });

  it("returns null for an external package", () => {
    const resolve = createModuleResolver({ files });
    expect(resolve("pages/users.tsx", "react")).toBeNull();
    expect(resolve("pages/users.tsx", "@tanstack/react-query")).toBeNull();
  });

  it("returns null when the relative target is not in the file set", () => {
    const resolve = createModuleResolver({ files });
    expect(resolve("pages/users.tsx", "../components/Missing")).toBeNull();
  });

  it("resolves a bare import against an explicit baseUrl", () => {
    const resolve = createModuleResolver({ files, baseUrl: "." });
    expect(resolve("pages/users.tsx", "components/UserTable")).toBe(
      "components/UserTable.tsx",
    );
  });

  it("does not resolve a bare import when no baseUrl is configured", () => {
    const resolve = createModuleResolver({ files });
    expect(resolve("pages/users.tsx", "components/UserTable")).toBeNull();
  });

  it("resolves a tsconfig path alias", () => {
    const resolve = createModuleResolver({
      files,
      baseUrl: ".",
      paths: { "@/*": ["src/*"] },
    });
    expect(resolve("pages/users.tsx", "@/utils/format")).toBe("src/utils/format.ts");
  });

  const wsFiles = [
    "apps/web/src/app.tsx",
    "packages/ui/index.ts",
    "packages/ui/Button.tsx",
    "packages/core/src/index.ts",
  ];

  it("resolves a workspace package by name to its index entry", () => {
    const resolve = createModuleResolver({
      files: wsFiles,
      workspaces: [{ name: "@acme/ui", dir: "packages/ui" }],
    });
    expect(resolve("apps/web/src/app.tsx", "@acme/ui")).toBe("packages/ui/index.ts");
  });

  it("resolves a workspace package by name to its explicit entry field", () => {
    const resolve = createModuleResolver({
      files: wsFiles,
      workspaces: [{ name: "@acme/core", dir: "packages/core", entry: "src/index.ts" }],
    });
    expect(resolve("apps/web/src/app.tsx", "@acme/core")).toBe("packages/core/src/index.ts");
  });

  it("resolves a subpath import into a workspace package", () => {
    const resolve = createModuleResolver({
      files: wsFiles,
      workspaces: [{ name: "@acme/ui", dir: "packages/ui" }],
    });
    expect(resolve("apps/web/src/app.tsx", "@acme/ui/Button")).toBe("packages/ui/Button.tsx");
  });

  it("returns null for a bare import that matches no workspace package", () => {
    const resolve = createModuleResolver({
      files: wsFiles,
      workspaces: [{ name: "@acme/ui", dir: "packages/ui" }],
    });
    expect(resolve("apps/web/src/app.tsx", "@acme/missing")).toBeNull();
  });
});
