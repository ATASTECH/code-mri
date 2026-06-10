import { Project, type SourceFile } from "ts-morph";
import { describe, expect, test } from "vitest";
import { extractImports } from "./imports.js";

function makeSource(code: string): SourceFile {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile("test.tsx", code);
}

describe("extractImports", () => {
  test("captures default imports", () => {
    const sf = makeSource(`import React from "react";`);
    expect(extractImports(sf)).toContainEqual({
      moduleSpecifier: "react",
      defaultImport: "React",
      namedImports: [],
      isTypeOnly: false,
    });
  });

  test("captures named imports with their module specifier", () => {
    const sf = makeSource(`import { useUsersQuery } from "../hooks/useUsers";`);
    const info = extractImports(sf).find(
      (i) => i.moduleSpecifier === "../hooks/useUsers",
    );
    expect(info?.namedImports).toEqual(["useUsersQuery"]);
  });

  test("flags type-only imports", () => {
    const sf = makeSource(`import type { Foo } from "./types";`);
    expect(extractImports(sf)[0]?.isTypeOnly).toBe(true);
  });
});
