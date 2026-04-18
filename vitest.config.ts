import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      thresholds: { lines: 70, functions: 70, branches: 65, statements: 70 },
    },
  },
  resolve: {
    alias: {
      "@breeze/common": r("./packages/common/src/index.ts"),
      "@breeze/policy": r("./packages/policy/src/index.ts"),
      "@breeze/broker": r("./packages/broker/src/index.ts"),
      "@breeze/connectors": r("./packages/connectors/src/index.ts"),
      "@breeze/ai": r("./packages/ai/src/index.ts"),
      "@breeze/db": r("./packages/db/src/index.ts"),
      "@breeze/memory": r("./packages/memory/src/index.ts"),
      "@breeze/planner": r("./packages/planner/src/index.ts"),
      "@breeze/workflows": r("./packages/workflows/src/index.ts"),
    },
  },
});
