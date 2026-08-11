import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "coverage",
      include: [
        "app/api/gitlab/tickets/route.ts",
        "app/api/security/route.ts",
        "app/api/setup/connect/route.ts",
        "app/api/setup/registry/connect/route.ts",
        "app/api/test-lab/route.ts",
        "components/ReleaseNotes.tsx",
        "lib/local-settings.ts",
        "lib/renovate-update.ts",
        "lib/repository-constants.ts",
        "lib/security-normalization.ts",
        "lib/security-sbom.ts",
        "lib/terraform-explorer.ts",
        "lib/test-lab.ts",
        "lib/uds-common.ts"
      ],
      thresholds: {
        statements: 70,
        branches: 60,
        functions: 70,
        lines: 70
      }
    }
  }
});
