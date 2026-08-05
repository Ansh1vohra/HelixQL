import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only the pure main-process logic is unit tested here — the schema
    // pruner and the DDL builder. Anything touching Electron or a live
    // database is covered by the end-to-end script instead, since mocking
    // a driver would only prove the mock works.
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
