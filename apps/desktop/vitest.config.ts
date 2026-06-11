import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@code-mri/engine/diff": fileURLToPath(
        new URL("../../engine/src/diff/reportDiff.ts", import.meta.url),
      ),
      "@": fileURLToPath(new URL(".", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./test/server-only.ts", import.meta.url),
      ),
      "node:sqlite": fileURLToPath(
        new URL("./test/fake-sqlite.ts", import.meta.url),
      ),
      sqlite: fileURLToPath(new URL("./test/fake-sqlite.ts", import.meta.url)),
    },
  },
  test: {
    include: ["lib/**/*.test.ts"],
    environment: "node",
  },
})
