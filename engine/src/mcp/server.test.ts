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

function manyNodeReport(count: number): Report {
  return {
    ...report,
    nodes: Array.from({ length: count }, (_, index) => ({
      id: `Component:src/App${index}.tsx#App${index}`,
      kind: "Component",
      name: `App${index}`,
      loc: { file: `src/App${index}.tsx`, line: 1 },
    })),
    issues: [],
  };
}

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
        "prepare_edit_context",
        "read_windows",
        "review_planned_change",
        "review_diff",
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

  test("keeps tools/list schema footprint bounded for agent sessions", async () => {
    const reportOnly = await handleMcpRequest(createMcpContext(report), {
      id: 21,
      method: "tools/list",
    });
    const scanEnabled = await handleMcpRequest(createMcpContext(undefined, undefined, { allowScan: true }), {
      id: 22,
      method: "tools/list",
    });

    const reportOnlyResult = reportOnly?.result as { tools: Array<{ name: string; outputSchema: unknown }> };
    const scanEnabledBytes = Buffer.byteLength(JSON.stringify(scanEnabled?.result), "utf8");
    const reportOnlyBytes = Buffer.byteLength(JSON.stringify(reportOnly?.result), "utf8");
    const outputSchemaBytes = reportOnlyResult.tools.reduce(
      (sum, tool) => sum + Buffer.byteLength(JSON.stringify(tool.outputSchema), "utf8"),
      0,
    );

    expect(reportOnlyBytes).toBeLessThanOrEqual(13_000);
    expect(scanEnabledBytes).toBeLessThanOrEqual(16_000);
    expect(outputSchemaBytes).toBeLessThanOrEqual(6_000);

    const forbidden = [
      "nodes",
      "edges",
      "issues",
      "breakingChanges",
      "testCommands",
      "risks",
      "verificationCommands",
    ];
    for (const tool of reportOnlyResult.tools) {
      const props = (tool.outputSchema as { properties?: Record<string, unknown> }).properties ?? {};
      for (const key of forbidden) {
        expect(Object.hasOwn(props, key)).toBe(false);
      }
      expect((tool.outputSchema as { required?: string[] }).required).toEqual(
        expect.arrayContaining(["tool", "plan", "confidence", "loc", "message"]),
      );
    }
    const askGraph = reportOnlyResult.tools.find((tool) => tool.name === "ask_graph")?.outputSchema as {
      properties?: Record<string, unknown>;
    };
    expect(askGraph?.properties?.result).toMatchObject({ type: "object", additionalProperties: true });
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

  test("serializes tools/call content.text as a compact summary by default", async () => {
    const response = (await handleMcpRequest(createMcpContext(report), {
      id: 5,
      method: "tools/call",
      params: { name: "find_dead_code", arguments: {} },
    })) as { result: { content: Array<{ type: string; text: string }>; structuredContent: unknown } };

    expect(response.result.content[0]?.text).toContain("Found 1 dead-code candidate");
    expect(response.result.content[0]?.text).toContain("tool=find_dead_code");
    expect(response.result.content[0]?.text).not.toBe(JSON.stringify(response.result.structuredContent));
    expect(JSON.stringify(response.result.structuredContent)).toContain("resultStats");
  });

  test("can serialize tools/call content.text as JSON for compatibility", async () => {
    const response = (await handleMcpRequest(createMcpContext(report, undefined, { textMode: "json" }), {
      id: 6,
      method: "tools/call",
      params: { name: "find_dead_code", arguments: {} },
    })) as { result: { content: Array<{ type: string; text: string }>; structuredContent: unknown } };

    expect(response.result.content[0]?.text).toBe(JSON.stringify(response.result.structuredContent));
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

  test("calls prepare_edit_context through MCP and returns budget stats", async () => {
    const response = (await handleMcpRequest(createMcpContext(report), {
      id: 50,
      method: "tools/call",
      params: {
        name: "prepare_edit_context",
        arguments: { task: "change App", files: ["src/App.tsx"], tokenBudget: 1000 },
      },
    })) as {
      result: {
        content: Array<{ text: string }>;
        structuredContent: { mustRead: Array<{ file: string }>; resultStats: { estimatedTokens: number } };
      };
    };

    expect(response.result.structuredContent.mustRead[0]?.file).toBe("src/App.tsx");
    expect(response.result.structuredContent.resultStats.estimatedTokens).toBeGreaterThan(0);
    expect(response.result.content[0]?.text).toContain("tool=prepare_edit_context");
  });

  test("paginates large result arrays with stable cursors", async () => {
    const ctx = createMcpContext(manyNodeReport(18));
    const first = (await handleMcpRequest(ctx, {
      id: 60,
      method: "tools/call",
      params: { name: "graph_search", arguments: { query: "App", limit: 5 } },
    })) as {
      result: {
        structuredContent: {
          nodes: Array<{ id: string }>;
          resultStats: { nextCursor?: string; omitted: Record<string, number> };
        };
      };
    };

    expect(first.result.structuredContent.nodes).toHaveLength(5);
    expect(first.result.structuredContent.resultStats.nextCursor).toBe("nodes:5");
    expect(first.result.structuredContent.resultStats.omitted.nodes).toBeGreaterThan(0);
    expect((first.result.structuredContent as { nextQueries?: Array<{ arguments: unknown }> }).nextQueries?.[0]?.arguments)
      .toMatchObject({ query: "App", cursor: "nodes:5" });

    const second = (await handleMcpRequest(ctx, {
      id: 61,
      method: "tools/call",
      params: {
        name: "graph_search",
        arguments: { query: "App", limit: 5, cursor: first.result.structuredContent.resultStats.nextCursor },
      },
    })) as { result: { structuredContent: { nodes: Array<{ id: string }> } } };

    expect(second.result.structuredContent.nodes[0]?.id).not.toBe(first.result.structuredContent.nodes[0]?.id);
  });

  test("deduplicates repeated payloads in one MCP session", async () => {
    const ctx = createMcpContext(report);
    await handleMcpRequest(ctx, {
      id: 70,
      method: "tools/call",
      params: { name: "graph_search", arguments: { query: "App" } },
    });

    const second = (await handleMcpRequest(ctx, {
      id: 71,
      method: "tools/call",
      params: { name: "graph_search", arguments: { query: "App" } },
    })) as {
      result: {
        structuredContent: {
          nodes: Array<{ deduped?: boolean; hash?: string }>;
          resultStats: { deduped?: number };
        };
      };
    };

    expect(second.result.structuredContent.nodes[0]?.deduped).toBe(true);
    expect(second.result.structuredContent.nodes[0]?.hash).toMatch(/^[a-f0-9]{40}$/);
    expect(second.result.structuredContent.resultStats.deduped).toBeGreaterThan(0);
  });

  test("clears dedupe state when loading a new active report", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "code-mri-mcp-"));
    try {
      const reportPath = path.join(dir, "report.json");
      writeFileSync(reportPath, JSON.stringify(report));
      const ctx = createMcpContext(report, undefined, { allowScan: true });
      await handleMcpRequest(ctx, {
        id: 80,
        method: "tools/call",
        params: { name: "graph_search", arguments: { query: "App" } },
      });

      await handleMcpRequest(ctx, {
        id: 81,
        method: "tools/call",
        params: { name: "load_report", arguments: { reportPath } },
      });
      const afterLoad = (await handleMcpRequest(ctx, {
        id: 82,
        method: "tools/call",
        params: { name: "graph_search", arguments: { query: "App" } },
      })) as { result: { structuredContent: { nodes: Array<{ deduped?: boolean }> } } };

      expect(afterLoad.result.structuredContent.nodes[0]?.deduped).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
