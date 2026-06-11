import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // End-to-end pipeline tests spawn the Python sidecar and run ts-morph.
    // Running every test file in parallel spawns dozens of subprocesses at
    // once and thrashes the machine, so files run sequentially with a generous
    // timeout. Tests within a file still run normally.
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
