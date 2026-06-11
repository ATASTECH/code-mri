import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { Report } from "../types.js";
import { describe, expect, test } from "vitest";
import { createMcpContext, handleMcpRequest } from "./server.js";

const report: Report = {
  schemaVersion: 4,
  project: { name: "demo", root: "/repo", stack: [] },
  summary: { files: 1, components: 1, models: 0, endpoints: 0 },
  nodes: [
    {
      id: "Component:src/App.tsx#App",
      kind: "Component",
      name: "App",
      loc: { file: "src/App.tsx", line: 1 },
    },
  ],
  edges: [],
  issues: [
    {
      kind: "DEAD_CODE",
      severity: "low",
      message: "App is never rendered",
      nodes: ["Component:src/App.tsx#App"],
      candidate: true,
    },
  ],
  scores: { health: 99, breakdown: { DEAD_CODE: 1 } },
};

describe("Code MRI MCP server handler", () => {
  test("responds to initialize and report-only tools/list", async () => {
    const ctx = createMcpContext(report);
    expect((await handleMcpRequest(ctx, { id: 1, method: "initialize" }))?.result).toMatchObject({
      capabilities: { tools: {} },
    });

    const tools = (await handleMcpRequest(ctx, { id: 2, method: "tools/list" }))?.result as {
      tools: Array<{
        name: string;
        inputSchema?: unknown;
        outputSchema?: { required?: string[] };
        annotations?: unknown;
      }>;
    };
    const names = tools.tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "impact_query",
        "graph_search",
        "find_dead_code",
        "check_breaking_changes",
        "get_node_context",
        "ask_graph",
        "recommend_tests",
      ]),
    );
    expect(names).not.toContain("scan_project");
    expect(names).not.toContain("load_report");
    for (const tool of tools.tools) {
      expect(tool.inputSchema).toBeTruthy();
      expect(tool.outputSchema).toBeTruthy();
      expect(tool.annotations).toBeTruthy();
      expect(tool.outputSchema?.required).toEqual(
        expect.arrayContaining(["tool", "plan", "confidence", "loc", "message"]),
      );
    }
  });

  test("lists scan tools only when scan is explicitly allowed", async () => {
    const response = await handleMcpRequest(createMcpContext(undefined, undefined, { allowScan: true }), {
      id: 20,
      method: "tools/list",
    });

    const tools = response?.result as { tools: Array<{ name: string }> };
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["scan_project", "load_report", "graph_search"]),
    );
  });

  test("calls tools and returns structured content with loc and confidence", async () => {
    const response = (await handleMcpRequest(createMcpContext(report), {
      id: 3,
      method: "tools/call",
      params: {
        name: "find_dead_code",
        arguments: {},
      },
    })) as { result: { structuredContent: { issues: Array<{ confidence: string; loc: unknown }> } } };

    expect(response.result.structuredContent.issues[0]).toMatchObject({
      confidence: "medium",
      loc: { file: "src/App.tsx", line: 1 },
    });
  });

  test("calls recommend_tests and returns focused commands", async () => {
    const response = (await handleMcpRequest(createMcpContext({
      ...report,
      nodes: [
        ...report.nodes,
        {
          id: "File:engine/src/mcp/server.ts",
          kind: "File",
          name: "engine/src/mcp/server.ts",
          loc: { file: "engine/src/mcp/server.ts" },
        },
        {
          id: "File:engine/src/mcp/server.test.ts",
          kind: "File",
          name: "engine/src/mcp/server.test.ts",
          loc: { file: "engine/src/mcp/server.test.ts" },
        },
      ],
    }), {
      id: 31,
      method: "tools/call",
      params: {
        name: "recommend_tests",
        arguments: { files: ["engine/src/mcp/server.ts"] },
      },
    })) as { result: { structuredContent: { testCommands: Array<{ command: string }> } } };

    expect(response.result.structuredContent.testCommands.map((item) => item.command)).toContain(
      "pnpm --filter @code-mri/engine test -- src/mcp/server.test.ts",
    );
  });

  test("rejects scan tools when scan is not explicitly allowed", async () => {
    const response = await handleMcpRequest(createMcpContext(report), {
      id: 30,
      method: "tools/call",
      params: { name: "scan_project", arguments: { path: "." } },
    });

    expect(response?.error?.message).toContain("--allow-scan");
  });

  test("load_report updates the active MCP report", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "code-mri-mcp-"));
    try {
      const reportPath = path.join(dir, "report.json");
      writeFileSync(reportPath, JSON.stringify(report));
      const ctx = createMcpContext(undefined, undefined, { allowScan: true });

      const loadResponse = await handleMcpRequest(ctx, {
        id: 40,
        method: "tools/call",
        params: { name: "load_report", arguments: { reportPath } },
      });
      expect(loadResponse?.error).toBeUndefined();

      const searchResponse = (await handleMcpRequest(ctx, {
        id: 41,
        method: "tools/call",
        params: { name: "graph_search", arguments: { query: "App" } },
      })) as { result: { structuredContent: { nodes: Array<{ id: string }> } } };

      expect(searchResponse.result.structuredContent.nodes[0]?.id).toBe("Component:src/App.tsx#App");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns an MCP error for unknown tools", async () => {
    const response = await handleMcpRequest(createMcpContext(report), {
      id: 4,
      method: "tools/call",
      params: { name: "missing_tool", arguments: {} },
    });

    expect(response?.error?.message).toContain("Unknown Code MRI MCP tool");
  });
});
