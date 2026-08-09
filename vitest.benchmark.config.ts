import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["benchmarks/**/*.test.ts"],
    testTimeout: 120_000,
  },
});
