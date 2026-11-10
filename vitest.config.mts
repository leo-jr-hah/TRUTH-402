import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const directory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(directory, "src"),
      "server-only": path.resolve(directory, "src/test/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test/offline.ts"],
    env: {
      VERDICTO_MEMORY_MODE: "demo",
      VERDICTO_TATUM_MODE: "demo",
      VERDICTO_AI_MODE: "demo",
      VERDICTO_STORAGE_MODE: "memory",
      VERDICTO_ENABLE_MAINNET_WRITES: "false",
      VERDICTO_PUBLIC_JUDGE_MODE: "false",
      VERDICTO_REQUIRE_OPERATOR_TOKEN: "false",
      VERDICTO_REQUIRE_STRICT_PTB_BINDING: "true",
      SUI_ALLOW_ANY_COIN_FALLBACK: "false",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: [
        "src/lib/identifiers.ts",
        "src/lib/market-maker.ts",
        "src/lib/memory/codec.ts",
        "src/lib/memory/credibility.ts",
        "src/lib/validation.ts",
        "src/lib/tatum.ts",
        "src/lib/x402.ts",
        "src/lib/forecast-integrity.ts",
        "src/lib/payment-auth.ts",
        "src/lib/market-category.ts",
        "src/lib/oracle-http.ts",
        "src/lib/services/oracle.ts",
        "src/lib/memory/prediction.ts",
        "src/lib/memory/rank-update.ts",
      ],
      thresholds: {
        lines: 85,
        functions: 85,
        statements: 85,
        branches: 75,
      },
    },
  },
});
