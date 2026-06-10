import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { edgeId, nodeId } from "../../ids.js";
import { analyzeTypeScript } from "./analyze.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "code-mri-reexport-"));
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

describe("analyzeTypeScript barrel re-export resolution", () => {
  it("follows a named re-export through an index barrel to render the real component", async () => {
    const files = [
      await write("ui/Button.tsx", `export function Button() { return <button />; }\n`),
      await write("ui/index.ts", `export { Button } from "./Button";\n`),
      await write(
        "pages/home.tsx",
        `import { Button } from "../ui";\nexport default function Home() { return <Button />; }\n`,
      ),
    ];

    const { edges } = analyzeTypeScript(dir, files);

    const home = nodeId("Page", "pages/home.tsx", "Home");
    const button = nodeId("Component", "ui/Button.tsx", "Button");
    const renders = edgeId("RENDERS", home, button);
    expect(edges.map((e) => e.id)).toContain(renders);
  });

  it("does not flatten members of `export * as ns` (namespace re-export)", async () => {
    const files = [
      await write("ui/Widget.tsx", `export function Widget() { return <div />; }\n`),
      await write("ui/index.ts", `export * as widgets from "./Widget";\n`),
      await write(
        "pages/ns.tsx",
        `import { Widget } from "../ui";\nexport default function NsPage() { return <Widget />; }\n`,
      ),
    ];

    const { edges } = analyzeTypeScript(dir, files);

    // `Widget` is not a flat export of the barrel (only `widgets` is), so no edge.
    const page = nodeId("Page", "pages/ns.tsx", "NsPage");
    const widget = nodeId("Component", "ui/Widget.tsx", "Widget");
    expect(edges.map((e) => e.id)).not.toContain(edgeId("RENDERS", page, widget));
  });

  it("follows `export *` through a barrel", async () => {
    const files = [
      await write("ui/Card.tsx", `export function Card() { return <div />; }\n`),
      await write("ui/index.ts", `export * from "./Card";\n`),
      await write(
        "pages/list.tsx",
        `import { Card } from "../ui";\nexport default function List() { return <Card />; }\n`,
      ),
    ];

    const { edges } = analyzeTypeScript(dir, files);

    const list = nodeId("Page", "pages/list.tsx", "List");
    const card = nodeId("Component", "ui/Card.tsx", "Card");
    expect(edges.map((e) => e.id)).toContain(edgeId("RENDERS", list, card));
  });
});
