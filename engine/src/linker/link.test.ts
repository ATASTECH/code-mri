import { describe, expect, test } from "vitest";
import type { BackendRoute } from "../parsers/py/assemble.js";
import type { ResolvedApiCall } from "../parsers/ts/analyze.js";
import { linkCrossStack } from "./link.js";

function call(partial: Partial<ResolvedApiCall>): ResolvedApiCall {
  return {
    method: "GET",
    url: "/users/",
    client: "api",
    dynamic: false,
    line: 1,
    file: "f.ts",
    callerId: "Hook:f.ts#useUsers",
    fullUrl: "/api/users/",
    ...partial,
  };
}

const routes: BackendRoute[] = [
  {
    method: "GET",
    path: "/api/users/",
    viewsetId: "v",
    endpointId: "ep:list",
    responseFields: [{ id: "Field:users#email", name: "email" }],
  },
  {
    method: "GET",
    path: "/api/users/{id}/",
    viewsetId: "v",
    endpointId: "ep:detail",
    responseFields: [{ id: "Field:profiles#email", name: "email" }],
  },
];

describe("linkCrossStack", () => {
  test("exact static match is high confidence", () => {
    const { edges } = linkCrossStack([call({})], routes);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      kind: "CALLS",
      from: "Hook:f.ts#useUsers",
      to: "ep:list",
      confidence: "high",
    });
  });

  test("template-param match is medium confidence", () => {
    const c = call({ fullUrl: "/api/users/{param}/", dynamic: true });
    const { edges } = linkCrossStack([c], routes);
    expect(edges[0]).toMatchObject({ to: "ep:detail", confidence: "medium" });
  });

  test("concrete path segment matches a backend route param", () => {
    const c = call({ fullUrl: "/api/users/123/", dynamic: false });
    const { edges } = linkCrossStack([c], routes);
    expect(edges[0]).toMatchObject({ to: "ep:detail", confidence: "medium" });
  });

  test("query strings do not prevent route matching", () => {
    const c = call({ fullUrl: "/api/users/123/?include=profile", dynamic: false });
    const { edges } = linkCrossStack([c], routes);
    expect(edges[0]).toMatchObject({ to: "ep:detail", confidence: "medium" });
  });

  test("exact static route wins over a param route", () => {
    const extendedRoutes: BackendRoute[] = [
      ...routes,
      {
        method: "GET",
        path: "/api/users/me/",
        viewsetId: "v",
        endpointId: "ep:me",
      },
    ];
    const c = call({ fullUrl: "/api/users/me/", dynamic: false });
    const { edges } = linkCrossStack([c], extendedRoutes);
    expect(edges[0]).toMatchObject({ to: "ep:me", confidence: "high" });
  });

  test("suffix match (missing baseURL prefix) is low confidence", () => {
    const c = call({ fullUrl: "/users/" });
    const { edges } = linkCrossStack([c], routes);
    expect(edges[0]).toMatchObject({ to: "ep:list", confidence: "low" });
  });

  test("method mismatch does not link and is reported unmatched", () => {
    const c = call({ method: "POST", fullUrl: "/api/users/{id}/" });
    const { edges, unmatched } = linkCrossStack([c], routes);
    expect(edges).toHaveLength(0);
    expect(unmatched).toHaveLength(1);
  });

  test("links response field uses only through the matched route", () => {
    const { edges } = linkCrossStack(
      [
        call({
          responseFields: [
            { field: "email", line: 2, confidence: "medium" },
            { field: "name", line: 3, confidence: "medium" },
          ],
        }),
      ],
      routes,
    );

    expect(edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "USES",
          from: "Hook:f.ts#useUsers",
          to: "Field:users#email",
          confidence: "medium",
          meta: expect.objectContaining({ source: "response-field", field: "email" }),
        }),
      ]),
    );
    expect(edges.some((edge) => edge.to === "Field:profiles#email")).toBe(false);
    expect(edges.some((edge) => edge.meta?.field === "name")).toBe(false);
  });
});
