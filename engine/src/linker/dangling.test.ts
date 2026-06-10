import { describe, expect, it } from "vitest";
import type { ResolvedApiCall } from "../parsers/ts/analyze.js";
import { danglingApiCallIssues } from "./link.js";

const call = (over: Partial<ResolvedApiCall>): ResolvedApiCall => ({
  method: "GET",
  url: "/api/ghost/",
  client: "api",
  dynamic: false,
  line: 1,
  file: "frontend/pages/x.tsx",
  callerId: "Component:frontend/pages/x.tsx:X",
  fullUrl: "/api/ghost/",
  ...over,
});

describe("danglingApiCallIssues", () => {
  it("flags an internal (relative-url) call that matched no backend route", () => {
    const issues = danglingApiCallIssues([call({})]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      kind: "DANGLING_API_CALL",
      candidate: true,
      nodes: ["Component:frontend/pages/x.tsx:X"],
      meta: { url: "/api/ghost/", method: "GET" },
    });
  });

  it("ignores calls to external absolute URLs", () => {
    const issues = danglingApiCallIssues([
      call({ fullUrl: "https://api.stripe.com/v1/charges" }),
    ]);
    expect(issues).toEqual([]);
  });

  it("skips calls with no caller node", () => {
    const issues = danglingApiCallIssues([call({ callerId: null })]);
    expect(issues).toEqual([]);
  });
});
