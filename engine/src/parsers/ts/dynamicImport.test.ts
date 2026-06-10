import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { edgeId, nodeId } from "../../ids.js";
import { analyzeTypeScript } from "./analyze.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "code-mri-dynimport-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function write(rel: string, content: string): Promise<{ path: string; abs: string }> {
  const abs = path.join(dir, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content);
  return { path: rel, abs };
}

describe("analyzeTypeScript dynamic import resolution", () => {
  it("links a next/dynamic-loaded component as RENDERS to the real component", async () => {
    const files = [
      await write("ui/Chart.tsx", `export default function Chart() { return <div />; }\n`),
      await write(
        "pages/dash.tsx",
        `import dynamic from "next/dynamic";\n` +
          `const LazyChart = dynamic(() => import("../ui/Chart"));\n` +
          `export default function Dash() { return <LazyChart />; }\n`,
      ),
    ];

    const { edges } = analyzeTypeScript(dir, files);

    const dash = nodeId("Page", "pages/dash.tsx", "Dash");
    const chart = nodeId("Component", "ui/Chart.tsx", "Chart");
    expect(edges.map((e) => e.id)).toContain(edgeId("RENDERS", dash, chart));
    // and a file-level IMPORTS edge to the dynamically imported module
    expect(edges.map((e) => e.id)).toContain(
      edgeId("IMPORTS", nodeId("File", "pages/dash.tsx"), nodeId("File", "ui/Chart.tsx")),
    );
  });

  it("links a React.lazy-loaded component as RENDERS", async () => {
    const files = [
      await write("ui/Panel.tsx", `export default function Panel() { return <div />; }\n`),
      await write(
        "pages/app.tsx",
        `import { lazy } from "react";\n` +
          `const Panel = lazy(() => import("../ui/Panel"));\n` +
          `export default function AppPage() { return <Panel />; }\n`,
      ),
    ];

    const { edges } = analyzeTypeScript(dir, files);

    const page = nodeId("Page", "pages/app.tsx", "AppPage");
    const panel = nodeId("Component", "ui/Panel.tsx", "Panel");
    expect(edges.map((e) => e.id)).toContain(edgeId("RENDERS", page, panel));
  });
});
