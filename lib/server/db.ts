import { PrismaClient } from "@prisma/client";
import { BUSINESS_DEFAULTS } from "@/lib/defaults";

const g = globalThis as unknown as { prisma?: PrismaClient };

export const db = g.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") g.prisma = db;

export async function getBusiness() {
  return db.business.upsert({ where: { id: "main" }, update: {}, create: { id: "main", ...BUSINESS_DEFAULTS } });
}
