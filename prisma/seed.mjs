// Cria o administrador inicial e o registro do estúdio. Idempotente: não sobrescreve nada existente.
import { randomBytes, scryptSync } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const BUSINESS_DEFAULTS = {
  name: "Meu Estúdio",
  confirmationTemplate: "Olá {cliente}! Seu horário no {negocio} está confirmado: {servico}, {data} às {hora}. Até lá! 💅",
  reminderTemplate: "Oi {cliente}, lembrando do seu horário amanhã no {negocio}: {servico}, {data} às {hora}. Responda aqui se precisar remarcar.",
};

const email = process.env.SEED_ADMIN_EMAIL?.toLowerCase();
const password = process.env.SEED_ADMIN_PASSWORD;
if (!email || !password || password.length < 12) {
  console.error("Defina SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD (mín. 12 caracteres) no .env.");
  process.exit(1);
}

const salt = randomBytes(16);
const passwordHash = `${salt.toString("hex")}:${scryptSync(password, salt, 64).toString("hex")}`;

await db.business.upsert({ where: { id: "main" }, update: {}, create: { id: "main", ...BUSINESS_DEFAULTS } });
const existing = await db.user.findUnique({ where: { email } });
if (existing) {
  console.log(`Administrador ${email} já existe — nada alterado.`);
} else {
  await db.user.create({ data: { email, name: process.env.SEED_ADMIN_NAME || "Administrador", passwordHash } });
  console.log(`Administrador ${email} criado.`);
}

if (process.env.SEED_DEMO === "1" && (await db.service.count()) === 0) {
  await db.service.createMany({
    data: [
      { name: "Manicure", description: "Esmaltação tradicional", durationMin: 45, priceCents: 4500 },
      { name: "Alongamento em gel", description: "Aplicação completa", durationMin: 120, priceCents: 15000 },
      { name: "Pedicure", description: "Cuidado completo dos pés", durationMin: 60, priceCents: 5500 },
    ],
  });
  console.log("Serviços de demonstração criados.");
}
await db.$disconnect();
