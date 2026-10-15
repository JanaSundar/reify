import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // `pnpm bench` runs the benchmark files instead of the test suite.
    include: mode === "bench" ? ["tests/**/*.bench.ts"] : ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: mode === "bench" ? 600_000 : 5_000,
  },
}));
