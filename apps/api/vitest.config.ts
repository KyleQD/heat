import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration suites share one Postgres instance; parallel files would
    // race on bulk fixtures and locks. Unit tests are unaffected by ordering.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
