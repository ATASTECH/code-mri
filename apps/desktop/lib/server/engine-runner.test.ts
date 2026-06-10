import { describe, expect, test } from "vitest"
import { parseProgressLine } from "./engine-runner"

describe("parseProgressLine", () => {
  test("accepts engine JSONL progress events", () => {
    expect(
      parseProgressLine(
        JSON.stringify({
          type: "progress",
          phase: "repo",
          percent: 42,
          message: "Scanning frontend",
          repoId: "frontend",
        }),
      ),
    ).toEqual({
      type: "progress",
      phase: "repo",
      percent: 42,
      message: "Scanning frontend",
      repoId: "frontend",
    })
  })

  test("ignores non-progress stdout lines", () => {
    expect(parseProgressLine("Code MRI report")).toBeNull()
    expect(parseProgressLine(JSON.stringify({ type: "summary" }))).toBeNull()
  })
})
