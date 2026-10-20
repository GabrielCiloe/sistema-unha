// Cria (se preciso), migra e popula o banco SEPARADO usado pelos testes e2e.
// Os testes apagam dados; por isso nunca devem apontar para o banco de desenvolvimento/produção.
// Uso: npm run test:db:setup   (requer o Postgres local do docker compose rodando)
import { execSync } from "node:child_process";

const dev = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!dev) throw new Error("Defina DATABASE_URL no .env.");
const devUrl = new URL(dev);
if (!["localhost", "127.0.0.1"].includes(devUrl.hostname)) throw new Error("O banco de testes só pode ser local.");

const testUrl =
  process.env.TEST_DATABASE_URL ??
  (() => {
    const t = new URL(dev);
    t.pathname = "/unha_test";
    return t.toString();
  })();

const run = (cmd, env = {}) => execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });
const psql = (sql) =>
  execSync(`docker exec sistema-unha-db-1 psql -U ${devUrl.username} -d postgres -tAc "${sql}"`, { encoding: "utf8" }).trim();

if (psql("SELECT 1 FROM pg_database WHERE datname='unha_test'") === "1") console.log("Banco unha_test já existe.");
else {
  psql("CREATE DATABASE unha_test");
  console.log("Banco unha_test criado.");
}

const env = { DATABASE_URL: testUrl, DIRECT_URL: testUrl };
run("npx prisma migrate deploy", env);
run("node prisma/seed.mjs", { ...env, SEED_ADMIN_EMAIL: "admin@local.test", SEED_ADMIN_PASSWORD: "dev-password-12345", SEED_DEMO: "1" });
console.log("Banco de testes pronto.");
