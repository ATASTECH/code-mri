import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { nodeId } from "../ids.js";
import { analyzeProject } from "./analyze.js";

const FIXTURE = fileURLToPath(new URL("../../test/fixtures/deadcode-app", import.meta.url));

const EXPORTED_ORPHAN = nodeId("Component", "components/ExportedOrphan.tsx", "ExportedOrphan");
const INTERNAL_ORPHAN = nodeId("Component", "components/InternalOrphan.tsx", "InternalOrphan");
const DEAD_HOOK = nodeId("Hook", "hooks/useDeadHook.ts", "useDeadHook");
const USED_CARD = nodeId("Component", "components/UsedCard.tsx", "UsedCard");
const LAYOUT_BADGE = nodeId("Component", "app/layout.tsx", "LayoutBadge");

describe("analyzeProject - dead-code golden (confidence + framework suppression)", () => {
  test("flags real dead code with the right removal confidence", async () => {
    const { report } = await analyzeProject(FIXTURE);
    const dead = report.issues.filter((i) => i.kind === "DEAD_CODE");
    const confidence = new Map(dead.map((i) => [i.nodes[0], i.meta?.confidence]));

    // Unexported + unused -> safe to remove (high).
    expect(confidence.get(INTERNAL_ORPHAN)).toBe("high");
    // Exported + unused -> maybe public API (low).
    expect(confidence.get(EXPORTED_ORPHAN)).toBe("low");
    // Unused hook is flagged.
    expect(confidence.has(DEAD_HOOK)).toBe(true);
  });

  test("does not flag used components or framework convention entries", async () => {
    const { report } = await analyzeProject(FIXTURE);
    const dead = new Set(report.issues.filter((i) => i.kind === "DEAD_CODE").map((i) => i.nodes[0]));

    expect(dead.has(USED_CARD)).toBe(false); // rendered by the page
    expect(dead.has(LAYOUT_BADGE)).toBe(false); // lives in app/layout.tsx (framework entry)
  });
});
