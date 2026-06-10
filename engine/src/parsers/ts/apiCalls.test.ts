import { Project, type SourceFile } from "ts-morph";
import { describe, expect, test } from "vitest";
import { extractApiCalls, extractAxiosClients } from "./apiCalls.js";

function makeSource(code: string, name = "h.ts"): SourceFile {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile(name, code);
}

describe("extractApiCalls", () => {
  test("detects client.get with a string url", () => {
    const calls = extractApiCalls(makeSource(`api.get("/users/");`));
    expect(calls[0]).toMatchObject({
      method: "GET",
      url: "/users/",
      client: "api",
      dynamic: false,
    });
  });

  test("maps the http verb from the method name", () => {
    const calls = extractApiCalls(
      makeSource(`api.post("/users/"); api.delete("/users/1/");`),
    );
    expect(calls.map((c) => c.method)).toEqual(["POST", "DELETE"]);
  });

  test("normalizes template-literal urls to a param pattern", () => {
    const calls = extractApiCalls(makeSource("api.get(`/users/${id}/`);"));
    expect(calls[0]).toMatchObject({ url: "/users/{param}/", dynamic: true });
  });

  test("detects fetch with method in options (default GET)", () => {
    const calls = extractApiCalls(
      makeSource(`fetch("/api/x/"); fetch("/api/y/", { method: "POST" });`),
    );
    expect(calls[0]).toMatchObject({ method: "GET", url: "/api/x/", client: "fetch" });
    expect(calls[1]).toMatchObject({ method: "POST", url: "/api/y/", client: "fetch" });
  });

  test("ignores non-http method calls and non-path string args", () => {
    const calls = extractApiCalls(
      makeSource(`arr.map(x => x); console.log("hi"); cache.get("token");`),
    );
    expect(calls).toEqual([]);
  });

  test("detects ky/got direct calls with method in options (default GET)", () => {
    const calls = extractApiCalls(
      makeSource(`ky("/api/x/"); got("/api/y/", { method: "POST" });`),
    );
    expect(calls[0]).toMatchObject({ method: "GET", url: "/api/x/", client: "ky" });
    expect(calls[1]).toMatchObject({ method: "POST", url: "/api/y/", client: "got" });
  });

  test("detects ky.post / got.get verb-style calls", () => {
    const calls = extractApiCalls(
      makeSource(`ky.post("/api/a/"); got.get("/api/b/");`),
    );
    expect(calls.map((c) => `${c.client} ${c.method}`)).toEqual(["ky POST", "got GET"]);
  });

  test("ties response.data field reads to the matching API call", () => {
    const calls = extractApiCalls(
      makeSource(`
        async function load() {
          const response = await api.get("/users/");
          return response.data.email;
        }
      `),
    );

    expect(calls[0]?.responseFields).toEqual([
      { field: "email", line: 4, confidence: "medium" },
    ]);
  });

  test("tracks destructured and aliased response data fields", () => {
    const calls = extractApiCalls(
      makeSource(`
        async function load() {
          const { data } = await api.get("/users/");
          const users = data;
          return users.map((u) => u.email);
        }
      `),
    );

    expect(calls[0]?.responseFields).toEqual([
      { field: "email", line: 5, confidence: "low" },
    ]);
  });

  test("tracks fields read inside response.data collection maps", () => {
    const calls = extractApiCalls(
      makeSource(`
        async function load() {
          const response = await api.get("/users/");
          return response.data.map((user) => ({ id: user.id, email: user.email }));
        }
      `),
    );

    expect(calls[0]?.responseFields).toEqual([
      { field: "id", line: 4, confidence: "low" },
      { field: "email", line: 4, confidence: "low" },
    ]);
  });

  test("tracks promise callback response fields without matching arbitrary data", () => {
    const calls = extractApiCalls(
      makeSource(`
        const local = { data: { email: "x" } };
        local.data.email;
        api.get("/users/").then((response) => response.data.name);
      `),
    );

    expect(calls[0]?.responseFields).toEqual([
      { field: "name", line: 4, confidence: "medium" },
    ]);
  });
});

describe("extractAxiosClients", () => {
  test("maps a client variable to its baseURL", () => {
    const sf = makeSource(`const api = axios.create({ baseURL: "/api" });`, "api.ts");
    expect(extractAxiosClients(sf)).toEqual({ api: "/api" });
  });

  test("ignores axios.create without a string baseURL", () => {
    const sf = makeSource(`const c = axios.create({});`, "api.ts");
    expect(extractAxiosClients(sf)).toEqual({});
  });
});
