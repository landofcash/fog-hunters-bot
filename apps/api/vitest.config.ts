import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/integration/**"],
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
        "src/server.ts",
        "src/types/**",
        "src/**/types.ts",
        "src/lib/domain.ts",
      ],
    },
  },
});
