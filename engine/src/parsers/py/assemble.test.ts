import { describe, expect, test } from "vitest";
import { buildGraph } from "../../graph/build.js";
import { nodeId } from "../../ids.js";
import { buildBackendGraph, type PyFacts } from "./assemble.js";

const FACTS: PyFacts = {
  base_dir: "backend",
  root_urlconf: "config.urls",
  models: [
    {
      file: "backend/users/models.py",
      name: "User",
      line: 4,
      fields: [
        { name: "email", type: "EmailField", line: 5, options: { unique: true } },
        { name: "name", type: "CharField", line: 6, options: {} },
      ],
    },
  ],
  serializers: [
    {
      file: "backend/users/serializers.py",
      name: "UserSerializer",
      line: 6,
      model: "User",
      fields: ["id", "email", "name"],
    },
  ],
  views: [
    {
      file: "backend/users/views.py",
      name: "UserViewSet",
      line: 7,
      is_model_viewset: true,
      serializer_class: "UserSerializer",
      queryset_model: "User",
    },
  ],
  registrations: [
    { file: "backend/users/urls.py", prefix: "users", viewset: "UserViewSet", basename: "user" },
  ],
  includes: [{ file: "backend/config/urls.py", prefix: "api/", module: "users.urls" }],
  celery_tasks: [
    { file: "backend/users/tasks.py", name: "send_welcome_email", line: 5 },
  ],
};

const MODEL = nodeId("Model", "backend/users/models.py", "User");
const EMAIL = nodeId("Field", "backend/users/models.py", "User", "email");
const SER = nodeId("Serializer", "backend/users/serializers.py", "UserSerializer");
const VIEW = nodeId("ViewSet", "backend/users/views.py", "UserViewSet");
const TASK = nodeId("CeleryTask", "backend/users/tasks.py", "send_welcome_email");

describe("buildBackendGraph", () => {
  test("creates model, field, serializer, viewset and celery nodes", () => {
    const ids = new Set(buildBackendGraph(FACTS).nodes.map((n) => n.id));
    for (const id of [MODEL, EMAIL, SER, VIEW, TASK]) expect(ids.has(id)).toBe(true);
  });

  test("links serializer to model and to each matching field, and view to serializer", () => {
    const { edges } = buildBackendGraph(FACTS);
    const has = (kind: string, from: string, to: string) =>
      edges.some((e) => e.kind === kind && e.from === from && e.to === to);
    expect(has("USES", SER, MODEL)).toBe(true);
    expect(has("USES", SER, EMAIL)).toBe(true); // impact-analysis backbone
    expect(has("USES", VIEW, SER)).toBe(true);
    expect(has("REFERENCES", MODEL, EMAIL)).toBe(true);
  });

  test("assembles canonical routes through include() + router prefixes", () => {
    const { routes } = buildBackendGraph(FACTS);
    const list = routes.find((r) => r.method === "GET" && r.path === "/api/users/");
    expect(list?.viewsetId).toBe(VIEW);
    expect(list?.responseFields).toEqual(
      expect.arrayContaining([
        { id: EMAIL, name: "email" },
        { id: nodeId("Field", "backend/users/models.py", "User", "name"), name: "name" },
      ]),
    );
    expect(routes.some((r) => r.path === "/api/users/{id}/" && r.method === "DELETE")).toBe(true);
  });

  test("maps serializer source aliases and skips method fields in response fields", () => {
    const facts: PyFacts = {
      ...FACTS,
      models: [
        {
          file: "backend/users/models.py",
          name: "User",
          line: 4,
          fields: [
            { name: "username", type: "CharField", line: 5, options: {} },
            { name: "email", type: "EmailField", line: 6, options: {} },
          ],
        },
      ],
      serializers: [
        {
          file: "backend/users/serializers.py",
          name: "UserSerializer",
          line: 6,
          model: "User",
          fields: ["displayName", "email", "computed"],
          declared_fields: [
            { name: "displayName", source: "username", kind: "field" },
            { name: "computed", source: null, kind: "method" },
          ],
        },
      ],
    };

    const { edges, routes } = buildBackendGraph(facts);
    const username = nodeId("Field", "backend/users/models.py", "User", "username");
    const list = routes.find((r) => r.method === "GET" && r.path === "/api/users/");

    expect(edges.some((e) => e.kind === "USES" && e.from === SER && e.to === username)).toBe(true);
    expect(list?.responseFields).toEqual(
      expect.arrayContaining([
        { id: username, name: "displayName" },
        { id: nodeId("Field", "backend/users/models.py", "User", "email"), name: "email" },
      ]),
    );
    expect(list?.responseFields?.some((field) => field.name === "computed")).toBe(false);
  });

  test("exposes each endpoint from its viewset", () => {
    const { nodes, edges } = buildBackendGraph(FACTS);
    const ep = nodes.find((n) => n.kind === "APIEndpoint" && n.name === "GET /api/users/");
    expect(ep).toBeDefined();
    expect(edges.some((e) => e.kind === "EXPOSES" && e.from === VIEW && e.to === ep?.id)).toBe(true);
  });
});

const PY_CALL_FACTS: PyFacts = {
  base_dir: "",
  root_urlconf: "urls",
  models: [],
  serializers: [],
  views: [
    {
      file: "api/views.py",
      name: "UserViewSet",
      line: 4,
      is_model_viewset: true,
      serializer_class: null,
      queryset_model: null,
    },
  ],
  registrations: [
    { file: "api/urls.py", prefix: "users", viewset: "UserViewSet", basename: "user", router: "router" },
  ],
  includes: [],
  celery_tasks: [],
  imports: [
    { file: "api/views.py", module: "services", name: "build_users", alias: "build_users", line: 1 },
    { file: "api/views.py", module: "api.formatters", name: null, alias: "formatters", line: 2 },
  ],
  functions: [
    { file: "api/services.py", name: "build_users", line: 1, owner: null, owner_kind: "module" },
    { file: "api/formatters.py", name: "format_user", line: 1, owner: null, owner_kind: "module" },
    { file: "api/views.py", name: "UserViewSet.list", line: 5, owner: "UserViewSet", owner_kind: "view" },
    { file: "api/views.py", name: "UserViewSet.normalize", line: 8, owner: "UserViewSet", owner_kind: "view" },
  ],
  function_calls: [
    { file: "api/views.py", caller: "UserViewSet.list", target: "build_users", target_module: "services", line: 6 },
    {
      file: "api/views.py",
      caller: "UserViewSet.list",
      target: "format_user",
      target_module: "api.formatters",
      line: 6,
    },
    { file: "api/views.py", caller: "UserViewSet.list", target: "UserViewSet.normalize", target_module: null, line: 7 },
  ],
};

describe("buildBackendGraph — Python function-level calls", () => {
  test("adds Python file imports and function CALLS edges", () => {
    const { edges } = buildBackendGraph(PY_CALL_FACTS);
    const viewsFile = nodeId("File", "api/views.py");
    const servicesFile = nodeId("File", "api/services.py");
    const formattersFile = nodeId("File", "api/formatters.py");
    const list = nodeId("Function", "api/views.py", "UserViewSet.list");
    const normalize = nodeId("Function", "api/views.py", "UserViewSet.normalize");
    const buildUsers = nodeId("Function", "api/services.py", "build_users");
    const formatUser = nodeId("Function", "api/formatters.py", "format_user");

    expect(edges.some((e) => e.kind === "IMPORTS" && e.from === viewsFile && e.to === servicesFile)).toBe(
      true,
    );
    expect(edges.some((e) => e.kind === "IMPORTS" && e.from === viewsFile && e.to === formattersFile)).toBe(
      true,
    );
    expect(edges.some((e) => e.kind === "CALLS" && e.from === list && e.to === buildUsers)).toBe(true);
    expect(edges.some((e) => e.kind === "CALLS" && e.from === list && e.to === formatUser)).toBe(true);
    expect(edges.some((e) => e.kind === "CALLS" && e.from === list && e.to === normalize)).toBe(true);
  });

  test("links views to methods so helper impact reaches endpoints", () => {
    const { nodes, edges } = buildBackendGraph(PY_CALL_FACTS);
    const view = nodeId("ViewSet", "api/views.py", "UserViewSet");
    const list = nodeId("Function", "api/views.py", "UserViewSet.list");
    const endpoint = nodeId("APIEndpoint", "GET /users/");

    expect(edges.some((e) => e.kind === "USES" && e.from === view && e.to === list)).toBe(true);
    expect(nodes.some((n) => n.id === endpoint)).toBe(true);
    expect(edges.some((e) => e.kind === "EXPOSES" && e.from === view && e.to === endpoint)).toBe(true);
  });

  test("helper impact traverses through method, view and endpoint", () => {
    const analysis = buildBackendGraph(PY_CALL_FACTS);
    const graph = buildGraph({ nodes: analysis.nodes, edges: analysis.edges });
    const helper = nodeId("Function", "api/services.py", "build_users");
    const impacted = new Set(graph.impact(helper).map((node) => node.id));

    expect(impacted.has(nodeId("Function", "api/views.py", "UserViewSet.list"))).toBe(true);
    expect(impacted.has(nodeId("ViewSet", "api/views.py", "UserViewSet"))).toBe(true);
    expect(impacted.has(nodeId("APIEndpoint", "GET /users/"))).toBe(true);
  });
});

const NESTED_SERIALIZER_FACTS: PyFacts = {
  base_dir: "",
  root_urlconf: null,
  models: [
    {
      file: "posts/models.py",
      name: "Post",
      line: 1,
      fields: [{ name: "title", type: "CharField", line: 2, options: {} }],
    },
  ],
  serializers: [
    { file: "posts/serializers.py", name: "PostSerializer", line: 1, model: "Post", fields: ["title"] },
    {
      file: "users/serializers.py",
      name: "UserSerializer",
      line: 5,
      model: null,
      fields: null,
      nested: [{ field: "posts", serializer: "PostSerializer" }],
    },
  ],
  views: [],
  registrations: [],
  includes: [],
  celery_tasks: [],
};

const NESTED_ROUTER_FACTS: PyFacts = {
  base_dir: "",
  root_urlconf: "urls",
  models: [],
  serializers: [],
  views: [
    {
      file: "views.py",
      name: "PostViewSet",
      line: 1,
      is_model_viewset: true,
      serializer_class: null,
      queryset_model: null,
    },
  ],
  registrations: [
    { file: "urls.py", prefix: "users", viewset: "UserViewSet", basename: null, router: "router" },
    { file: "urls.py", prefix: "posts", viewset: "PostViewSet", basename: null, router: "users_router" },
  ],
  includes: [],
  celery_tasks: [],
  nested_routers: [
    { file: "urls.py", name: "users_router", parent: "router", parent_prefix: "users", lookup: "user" },
  ],
};

describe("buildBackendGraph — DRF nested depth", () => {
  test("links a parent serializer to its nested serializer with USES", () => {
    const { edges } = buildBackendGraph(NESTED_SERIALIZER_FACTS);
    const parent = nodeId("Serializer", "users/serializers.py", "UserSerializer");
    const child = nodeId("Serializer", "posts/serializers.py", "PostSerializer");
    expect(edges.some((e) => e.kind === "USES" && e.from === parent && e.to === child)).toBe(true);
  });

  test("composes nested router prefixes (drf-nested-routers)", () => {
    const { routes } = buildBackendGraph(NESTED_ROUTER_FACTS);
    const paths = routes.map((r) => `${r.method} ${r.path}`);
    expect(paths).toContain("GET /users/{user_pk}/posts/");
    expect(paths).toContain("POST /users/{user_pk}/posts/");
    expect(paths).toContain("DELETE /users/{user_pk}/posts/{id}/");
    // The nested route is exposed by the child ViewSet.
    const nested = routes.find((r) => r.method === "GET" && r.path === "/users/{user_pk}/posts/");
    expect(nested?.viewsetId).toBe(nodeId("ViewSet", "views.py", "PostViewSet"));
  });
});

const HTTP_FACTS: PyFacts = {
  base_dir: "",
  root_urlconf: null,
  models: [],
  serializers: [],
  views: [],
  registrations: [],
  includes: [],
  celery_tasks: [],
  http_routers: [
    { file: "main.py", name: "app", framework: "fastapi", kind: "app", prefix: "" },
    { file: "main.py", name: "router", framework: "fastapi", kind: "router", prefix: "/users" },
  ],
  http_routes: [
    { file: "main.py", router: "app", method: "GET", path: "/health", handler: "health", line: 5 },
    { file: "main.py", router: "router", method: "GET", path: "/", handler: "list_users", line: 8 },
    {
      file: "main.py",
      router: "router",
      method: "GET",
      path: "/{user_id}",
      handler: "get_user",
      line: 11,
    },
  ],
  http_mounts: [{ file: "main.py", parent: "app", child: "router", prefix: "/api" }],
};

describe("buildBackendGraph — FastAPI/Flask http routes", () => {
  test("resolves mount prefix + router own-prefix + route path", () => {
    const { routes } = buildBackendGraph(HTTP_FACTS);
    expect(routes.map((r) => `${r.method} ${r.path}`).sort()).toEqual(
      ["GET /api/users", "GET /api/users/{user_id}", "GET /health"].sort(),
    );
  });

  test("emits Service nodes for the app and router with framework meta", () => {
    const { nodes } = buildBackendGraph(HTTP_FACTS);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect(byId.get(nodeId("Service", "main.py", "router"))?.meta).toMatchObject({
      framework: "fastapi",
      type: "router",
    });
  });

  test("registers the router into the app and exposes endpoints", () => {
    const { nodes, edges } = buildBackendGraph(HTTP_FACTS);
    const router = nodeId("Service", "main.py", "router");
    const app = nodeId("Service", "main.py", "app");
    const endpoint = nodeId("APIEndpoint", "GET /api/users/{user_id}");
    const routeId = nodeId("Route", "main.py", "GET /api/users/{user_id}");
    expect(edges.some((e) => e.kind === "REGISTERED_IN" && e.from === router && e.to === app)).toBe(
      true,
    );
    expect(nodes.some((n) => n.id === endpoint && n.kind === "APIEndpoint")).toBe(true);
    expect(edges.some((e) => e.kind === "EXPOSES" && e.from === routeId && e.to === endpoint)).toBe(
      true,
    );
  });

  test("links each route to its handler function with USES", () => {
    const { edges } = buildBackendGraph(HTTP_FACTS);
    const routeId = nodeId("Route", "main.py", "GET /api/users");
    const handler = nodeId("Function", "main.py", "list_users");
    expect(edges.some((e) => e.kind === "USES" && e.from === routeId && e.to === handler)).toBe(
      true,
    );
  });
});
