import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { nodeId } from "../../ids.js";
import { scanRepo } from "../../scanner/scan.js";
import { analyzeTypeScript } from "./analyze.js";

const FIXTURE = fileURLToPath(
  new URL("../../../test/fixtures/sample-app", import.meta.url),
);

async function analyzeFixture() {
  const scan = await scanRepo(FIXTURE);
  const tsFiles = scan.files.filter((f) => f.category === "typescript");
  return analyzeTypeScript(scan.root, tsFiles);
}

describe("analyzeTypeScript (golden fixture)", () => {
  test("creates component, hook and page nodes", async () => {
    const a = await analyzeFixture();
    const ids = new Set(a.nodes.map((n) => n.id));
    expect(ids.has(nodeId("Component", "frontend/components/UserTable.tsx", "UserTable"))).toBe(true);
    expect(ids.has(nodeId("Component", "frontend/components/Unused.tsx", "Unused"))).toBe(true);
    expect(ids.has(nodeId("Hook", "frontend/hooks/useUsers.ts", "useUsersQuery"))).toBe(true);
    expect(ids.has(nodeId("Page", "frontend/pages/users.tsx", "UsersPage"))).toBe(true);
  });

  test("links the page to the hook it uses and the component it renders", async () => {
    const a = await analyzeFixture();
    const page = nodeId("Page", "frontend/pages/users.tsx", "UsersPage");
    const hook = nodeId("Hook", "frontend/hooks/useUsers.ts", "useUsersQuery");
    const comp = nodeId("Component", "frontend/components/UserTable.tsx", "UserTable");

    const has = (kind: string, from: string, to: string) =>
      a.edges.some((e) => e.kind === kind && e.from === from && e.to === to);

    expect(has("USES", page, hook)).toBe(true);
    expect(has("RENDERS", page, comp)).toBe(true);
  });

  test("creates file IMPORTS edges between internal modules", async () => {
    const a = await analyzeFixture();
    const has = (from: string, to: string) =>
      a.edges.some(
        (e) =>
          e.kind === "IMPORTS" &&
          e.from === nodeId("File", from) &&
          e.to === nodeId("File", to),
      );
    expect(has("frontend/pages/users.tsx", "frontend/hooks/useUsers.ts")).toBe(true);
    expect(has("frontend/hooks/useUsers.ts", "frontend/lib/api.ts")).toBe(true);
  });

  test("resolves the api call url against the axios baseURL", async () => {
    const a = await analyzeFixture();
    const call = a.apiCalls.find((c) => c.method === "GET");
    expect(call?.fullUrl).toBe("/api/users/");
    expect(call?.callerId).toBe(nodeId("Hook", "frontend/hooks/useUsers.ts", "useUsersQuery"));
  });

  test("keeps service-object API calls with the file as fallback caller", () => {
    const root = mkdtempSync(path.join(tmpdir(), "code-mri-ts-service-"));
    try {
      mkdirSync(path.join(root, "src"), { recursive: true });
      writeFileSync(
        path.join(root, "src/users-api.ts"),
        [
          "export const usersApi = {",
          "  list: () => api.get('/api/users/'),",
          "  create(input) {",
          "    return fetch('/api/users/', { method: 'POST', body: JSON.stringify(input) });",
          "  },",
          "};",
        ].join("\n"),
      );

      const a = analyzeTypeScript(root, [
        { path: "src/users-api.ts", abs: path.join(root, "src/users-api.ts") },
      ]);

      expect(a.apiCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            method: "GET",
            fullUrl: "/api/users/",
            callerId: nodeId("File", "src/users-api.ts"),
          }),
          expect.objectContaining({
            method: "POST",
            fullUrl: "/api/users/",
            callerId: nodeId("File", "src/users-api.ts"),
          }),
        ]),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("links resolved plain function calls with CALLS edges", () => {
    const root = mkdtempSync(path.join(tmpdir(), "code-mri-ts-calls-"));
    try {
      mkdirSync(path.join(root, "src"), { recursive: true });
      writeFileSync(
        path.join(root, "src/math.ts"),
        [
          "export function normalize(input: string) {",
          "  return input.trim();",
          "}",
          "export function format(input: string) {",
          "  return normalize(input).toUpperCase();",
          "}",
        ].join("\n"),
      );
      writeFileSync(
        path.join(root, "src/view.ts"),
        [
          "import { format } from './math';",
          "export function renderName(input: string) {",
          "  return format(input);",
          "}",
        ].join("\n"),
      );

      const files = ["src/math.ts", "src/view.ts"].map((rel) => ({
        path: rel,
        abs: path.join(root, rel),
      }));
      const a = analyzeTypeScript(root, files);
      const normalize = nodeId("Function", "src/math.ts", "normalize");
      const format = nodeId("Function", "src/math.ts", "format");
      const renderName = nodeId("Function", "src/view.ts", "renderName");

      expect(
        a.edges.some(
          (e) =>
            e.kind === "CALLS" &&
            e.from === format &&
            e.to === normalize &&
            e.confidence === "high",
        ),
      ).toBe(true);
      expect(
        a.edges.some(
          (e) =>
            e.kind === "CALLS" &&
            e.from === renderName &&
            e.to === format &&
            e.confidence === "high",
        ),
      ).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("analyzeTypeScript - type-flow and React context semantics", () => {
  test("links components to prop types and context providers/consumers", () => {
    const root = mkdtempSync(path.join(tmpdir(), "code-mri-ts-"));
    try {
      mkdirSync(path.join(root, "src"), { recursive: true });
      writeFileSync(
        path.join(root, "src/context.tsx"),
        [
          "import { createContext, useContext } from 'react';",
          "",
          "export interface Session { userId: string }",
          "export const SessionContext = createContext<Session | null>(null);",
          "",
          "export function SessionProvider(props: { value: Session; children: React.ReactNode }) {",
          "  return <SessionContext.Provider value={props.value}>{props.children}</SessionContext.Provider>;",
          "}",
          "",
          "export function useSession() {",
          "  return useContext(SessionContext);",
          "}",
        ].join("\n"),
      );
      writeFileSync(
        path.join(root, "src/Profile.tsx"),
        [
          "import { Session, useSession } from './context';",
          "",
          "export type ProfileProps = { session: Session };",
          "export function Profile(props: ProfileProps) {",
          "  const session = useSession();",
          "  return <div>{session?.userId ?? props.session.userId}</div>;",
          "}",
        ].join("\n"),
      );

      const files = ["src/context.tsx", "src/Profile.tsx"].map((rel) => ({
        path: rel,
        abs: path.join(root, rel),
      }));
      const a = analyzeTypeScript(root, files);
      const provider = nodeId("Component", "src/context.tsx", "SessionProvider");
      const hook = nodeId("Hook", "src/context.tsx", "useSession");
      const context = nodeId("Context", "src/context.tsx", "SessionContext");
      const profile = nodeId("Component", "src/Profile.tsx", "Profile");
      const profileProps = nodeId("Type", "src/Profile.tsx", "ProfileProps");
      const sessionType = nodeId("Type", "src/context.tsx", "Session");

      expect(a.nodes.some((n) => n.id === context && n.kind === "Context")).toBe(true);
      expect(a.nodes.some((n) => n.id === sessionType && n.kind === "Type")).toBe(true);
      expect(a.edges.some((e) => e.kind === "PROVIDES" && e.from === provider && e.to === context)).toBe(
        true,
      );
      expect(a.edges.some((e) => e.kind === "CONSUMES" && e.from === hook && e.to === context)).toBe(
        true,
      );
      expect(a.edges.some((e) => e.kind === "TYPES" && e.from === profile && e.to === profileProps)).toBe(
        true,
      );
      expect(
        a.edges.some((e) => e.kind === "TYPES" && e.from === profileProps && e.to === sessionType),
      ).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
