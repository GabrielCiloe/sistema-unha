import { defineConfig } from "@playwright/test";

try {
  process.loadEnvFile(".env");
} catch {}

// Os testes APAGAM dados. Por isso rodam num banco separado (unha_test), numa porta própria (3100) e com
// build próprio (.next-test): nunca tocam no banco/servidor de desenvolvimento. Crie o banco com: npm run test:db:setup
const devUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "";
const TEST_DB =
  process.env.TEST_DATABASE_URL ??
  (devUrl ? (() => { const u = new URL(devUrl); u.pathname = "/unha_test"; return u.toString(); })() : "");
const PORT = 3100;
const ORIGIN = `http://localhost:${PORT}`;

// Herdado pelos workers dos testes (que também usam o Prisma direto).
process.env.DATABASE_URL = TEST_DB;
process.env.DIRECT_URL = TEST_DB;

export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  use: { baseURL: ORIGIN, trace: "retain-on-failure" },
  webServer: {
    command: `node -e "require('fs').rmSync('.next-test',{recursive:true,force:true})" && npm run build && npx next start -p ${PORT}`,
    url: ORIGIN,
    reuseExistingServer: false, // nunca reutiliza um servidor que possa estar ligado ao banco de desenvolvimento
    timeout: 300_000,
    env: {
      NEXT_DIST_DIR: ".next-test",
      DATABASE_URL: TEST_DB,
      DIRECT_URL: TEST_DB,
      APP_ORIGIN: ORIGIN,
      BOOKING_RATE_LIMIT: "1000", // os testes criam muitas reservas do mesmo IP; em produção vale o padrão (10 / 10 min)
    },
  },
});
