import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globals: true,
    coverage: {
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "build/**",
        "dist/**",
        "tests/**",
        "src/index.ts",
        "src/api/contracts.ts",
      ],
    },
  },
});
