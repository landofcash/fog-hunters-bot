import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    globals: true,
    fileParallelism: false,
    sequence: {
      concurrent: false,
    },
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
