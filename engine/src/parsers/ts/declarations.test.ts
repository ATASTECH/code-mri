import { Project, type SourceFile } from "ts-morph";
import { describe, expect, test } from "vitest";
import { extractDeclarations } from "./declarations.js";

function makeSource(code: string, name = "test.tsx"): SourceFile {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile(name, code);
}

describe("extractDeclarations", () => {
  test("classifies a PascalCase JSX function as a Component", () => {
    const sf = makeSource(`export function UserTable() { return <table />; }`);
    const d = extractDeclarations(sf).find((x) => x.name === "UserTable");
    expect(d).toMatchObject({ kind: "Component", isExported: true, isDefaultExport: false });
  });

  test("classifies a use* function as a Hook", () => {
    const sf = makeSource(`export function useUsersQuery() { return 1; }`, "h.ts");
    expect(extractDeclarations(sf).find((x) => x.name === "useUsersQuery")?.kind).toBe(
      "Hook",
    );
  });

  test("classifies a plain function as Function and tracks export flag", () => {
    const sf = makeSource(`function helper() { return 2; }`, "u.ts");
    expect(extractDeclarations(sf).find((x) => x.name === "helper")).toMatchObject({
      kind: "Function",
      isExported: false,
    });
  });

  test("detects default-exported components", () => {
    const sf = makeSource(`export default function Page() { return <div />; }`);
    const d = extractDeclarations(sf).find((x) => x.name === "Page");
    expect(d).toMatchObject({ kind: "Component", isDefaultExport: true });
  });

  test("detects arrow-function components assigned to a const", () => {
    const sf = makeSource(`export const Card = () => <div />;`);
    expect(extractDeclarations(sf).find((x) => x.name === "Card")?.kind).toBe("Component");
  });

  test("ignores non-function const initializers (e.g. axios.create)", () => {
    const sf = makeSource(`export const api = axios.create({ baseURL: "/api" });`, "api.ts");
    expect(extractDeclarations(sf).some((x) => x.name === "api")).toBe(false);
  });
});
