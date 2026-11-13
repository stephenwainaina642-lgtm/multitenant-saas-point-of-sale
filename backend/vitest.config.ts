import { defineConfig } from "vitest/config";

// Default suite: deterministic tests only. Race/concurrency tests live in
// tests/race and run through `npm run test:race` (see vitest.race.config.ts).
export default defineConfig({
  test: {
    include: ["tests/api/**/*.test.ts", "tests/db/**/*.test.ts"],
    globalSetup: ["tests/support/globalSetup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 90_000,
    reporters: ["default"],
  },
});
