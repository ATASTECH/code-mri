import { describe, expect, it } from "vitest"
import {
  buildEngineNodeArgs,
  buildScanProjectArgs,
  type EngineProjectInput,
} from "./engine-args"

const base: EngineProjectInput = {
  projectName: "Acme",
  repos: [
    { id: "frontend", name: "Frontend", root: "/repos/web", role: "frontend" },
    { id: "backend", name: "Backend", root: "/repos/api", role: "backend" },
  ],
}

describe("buildScanProjectArgs", () => {
  it("builds scan-project args with name, json out, and per-repo bindings", () => {
    const args = buildScanProjectArgs("/cli.js", "/out.json", base)

    expect(args.slice(0, 6)).toEqual([
      "/cli.js",
      "scan-project",
      "--name",
      "Acme",
      "--json",
      "/out.json",
    ])
    expect(args).toContain("frontend=/repos/web:frontend")
    expect(args).toContain("backend=/repos/api:backend")
    expect(args).toContain("frontend=Frontend")
    expect(args).not.toContain("--cache-dir")
  })

  it("appends --cache-dir when a cache directory is given", () => {
    const args = buildScanProjectArgs("/cli.js", "/out.json", {
      ...base,
      cacheDir: "/data/cache/p1",
    })

    const i = args.indexOf("--cache-dir")
    expect(i).toBeGreaterThan(-1)
    expect(args[i + 1]).toBe("/data/cache/p1")
  })

  it("can bypass cache and request progress output", () => {
    const args = buildScanProjectArgs("/cli.js", "/out.json", {
      ...base,
      cacheDir: "/data/cache/p1",
      noCache: true,
      progress: true,
    })

    expect(args).toContain("--cache-dir")
    expect(args).toContain("--no-cache")
    expect(args).toContain("--progress")
  })

  it("passes an explicit governance config to the engine CLI", () => {
    const args = buildScanProjectArgs("/cli.js", "/out.json", {
      ...base,
      configPath: "/repos/.codemri.yml",
    })

    const i = args.indexOf("--config")
    expect(i).toBeGreaterThan(-1)
    expect(args[i + 1]).toBe("/repos/.codemri.yml")
  })

  it("prepends a bounded old-space limit for the engine child process", () => {
    expect(buildEngineNodeArgs(["/cli.js"], 2048)).toEqual([
      "--max-old-space-size=2048",
      "/cli.js",
    ])
  })
})
