import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { nodeId } from "../../ids.js";
import { analyzeDockerCompose } from "./analyze.js";

const FIXTURE = fileURLToPath(new URL("../../../test/fixtures/sample-app", import.meta.url));

describe("analyzeDockerCompose", () => {
  test("creates DockerService nodes and depends_on edges", () => {
    const analysis = analyzeDockerCompose(FIXTURE, [{ path: "docker-compose.yml" }]);

    expect(analysis.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining([
        nodeId("DockerService", "docker-compose.yml", "backend"),
        nodeId("DockerService", "docker-compose.yml", "postgres"),
        nodeId("DockerService", "docker-compose.yml", "redis"),
        nodeId("DockerService", "docker-compose.yml", "celery"),
      ]),
    );
    expect(analysis.edges.map((edge) => [edge.from, edge.to])).toEqual(
      expect.arrayContaining([
        [
          nodeId("DockerService", "docker-compose.yml", "backend"),
          nodeId("DockerService", "docker-compose.yml", "postgres"),
        ],
        [
          nodeId("DockerService", "docker-compose.yml", "backend"),
          nodeId("DockerService", "docker-compose.yml", "redis"),
        ],
        [
          nodeId("DockerService", "docker-compose.yml", "celery"),
          nodeId("DockerService", "docker-compose.yml", "redis"),
        ],
      ]),
    );
  });
});
