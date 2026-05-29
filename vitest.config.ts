import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Standard Vitest with Node environment for domain/application layer tests.
    // These tests use in-memory fakes and don't need the Workers runtime.
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
    },
  },
  resolve: {
    // Allow importing .js extensions in TypeScript source (Workers convention).
    extensions: [".ts", ".js"],
  },
});
