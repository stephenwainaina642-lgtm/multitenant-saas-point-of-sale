import { defineConfig } from "vitest/config";

// Concurrency characterization tests. Outcomes depend on timing, so these are
// kept out of the default suite. Until the Stage 2b fixes land, failures here
// are EXPECTED and demonstrate real defects.
export default defineConfig({
  test: {
    include: ["tests/race/**/*.test.ts"],
    globalSetup: ["tests/support/globalSetup.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 90_000,
  },
});
