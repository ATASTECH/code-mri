import { describe, expect, test } from "vitest";
import {
  CODE_MRI_PRESET_NAMES,
  createCodeMriPresetConfig,
  formatCodeMriConfig,
} from "./presets.js";

describe("Code MRI config presets", () => {
  test("creates valid configs for every public preset", () => {
    for (const name of CODE_MRI_PRESET_NAMES) {
      const config = createCodeMriPresetConfig(name);
      expect(config.ci.gates.minHealth).toBeGreaterThan(0);
      expect(config.risk.ignorePaths).toContain("examples/**");
      expect(formatCodeMriConfig(config)).toContain("risk:");
    }
  });

  test("next-django preset blocks direct frontend imports from backend code", () => {
    const config = createCodeMriPresetConfig("next-django");

    expect(config.boundaries.groups.map((group) => group.id)).toEqual(["frontend", "backend"]);
    expect(config.boundaries.rules[0]).toMatchObject({
      from: ["frontend"],
      to: ["backend"],
      allow: false,
      edgeKinds: ["IMPORTS"],
    });
  });
});
