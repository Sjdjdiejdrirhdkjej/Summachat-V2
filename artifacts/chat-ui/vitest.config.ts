import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Stale: references removed session-store research helpers; fix or delete that file to re-include.
    exclude: ["src/lib/session-store.test.ts"],
  },
});
