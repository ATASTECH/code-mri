import type { Issue } from "../types.js";
import { describe, expect, test } from "vitest";
import { computeHealth } from "./health.js";

const issue = (kind: Issue["kind"]): Issue => ({
  kind,
  severity: "low",
  message: "",
  nodes: [],
});

describe("computeHealth", () => {
  test("deducts transparent per-kind weights from 100", () => {
    const { health, breakdown } = computeHealth([
      issue("DEAD_CODE"),
      issue("DEAD_CODE"),
      issue("CIRCULAR_DEPENDENCY"),
      issue("SECRET_CANDIDATE"),
      issue("UNCOVERED_RISKY_NODE"),
      issue("COMPLEXITY_HOTSPOT"),
      issue("BOUNDARY_VIOLATION"),
    ]);
    expect(breakdown).toEqual({
      DEAD_CODE: 2,
      CIRCULAR_DEPENDENCY: 10,
      SECRET_CANDIDATE: 15,
      UNCOVERED_RISKY_NODE: 4,
      COMPLEXITY_HOTSPOT: 3,
      BOUNDARY_VIOLATION: 8,
    });
    expect(health).toBe(58);
  });

  test("a clean project scores 100 with an empty breakdown", () => {
    expect(computeHealth([])).toEqual({ health: 100, breakdown: {} });
  });

  test("does not penalize low-confidence exported dead-code candidates", () => {
    expect(
      computeHealth([
        {
          ...issue("DEAD_CODE"),
          candidate: true,
          meta: { confidence: "low" },
        },
      ]),
    ).toEqual({ health: 100, breakdown: {} });
  });

  test("never goes below 0", () => {
    const many = Array.from({ length: 50 }, () => issue("CIRCULAR_DEPENDENCY"));
    expect(computeHealth(many).health).toBe(0);
  });
});
