import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Testes unitários (npm run test:unit): funções puras e regras com banco simulado. Os de fluxo ficam no Playwright (npm test).
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)).replace(/[\\/]$/, "") } },
  test: { environment: "node", include: ["tests/unit/**/*.test.ts"] },
});
