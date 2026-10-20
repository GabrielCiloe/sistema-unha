import { DEFAULT_RETURN_TEMPLATE } from "@/lib/defaults";
import { renderTemplate } from "@/lib/templates";
import { db } from "./db";
import { localToDate } from "./slots";
import { sendText } from "./whatsapp";

const DAY = 86400_000;
const MAX_PER_RUN = 3; // poucos por execução, espaçados por pausas aleatórias
const MAX_PER_DAY = 20; // teto diário para não parecer disparo em massa

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const localDate = (d: Date) => new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10); // UTC-3

type Biz = { name: string; returnAfterDays: number; returnWindowStart: number; returnWindowEnd: number; returnTemplate: string };

// Sorteia um instante dentro da janela de envio: hoje (se ainda há janela) ou amanhã.
export function planSendTime(biz: Pick<Biz, "returnWindowStart" | "returnWindowEnd">, now = new Date()) {
  const today = localDate(now);
  let from = Math.max(localToDate(today, biz.returnWindowStart).getTime(), now.getTime() + 2 * 60_000);
  let to = localToDate(today, biz.returnWindowEnd).getTime();
  if (to - from < 5 * 60_000) {
    const tomorrow = localDate(new Date(now.getTime() + DAY));
    from = localToDate(tomorrow, biz.returnWindowStart).getTime();
    to = localToDate(tomorrow, biz.returnWindowEnd).getTime();
  }
  return new Date(rand(from, to));
}

// Escolhe uma das versões da mensagem (separadas por uma linha "---").
export function pickVariant(template: string) {
  const parts = (template.trim() || DEFAULT_RETURN_TEMPLATE).split(/^\s*---\s*$/m).map((p) => p.trim()).filter(Boolean);
  return parts[Math.floor(Math.random() * parts.length)];
}

// Clientes cujo último atendimento concluído foi há N dias ou mais, sem novo agendamento e sem convite para essa visita.
async function eligible(biz: Biz, now: Date) {
  const threshold = new Date(now.getTime() - biz.returnAfterDays * DAY);
  const customers = await db.customer.findMany({
    where: { returnOptOut: false, appointments: { some: { status: "COMPLETED", startsAt: { lte: threshold } } } },
    include: {
      appointments: {
        where: { status: { in: ["PENDING_PAYMENT", "CONFIRMED", "COMPLETED"] } },
        orderBy: { startsAt: "desc" },
        take: 1,
        include: { items: true },
      },
    },
  });
  return customers.flatMap((c) => {
    const last = c.appointments[0];
    if (!last || last.status !== "COMPLETED" || last.startsAt > threshold) return [];
    if (c.returnSentAt && c.returnSentAt >= last.startsAt) return []; // já convidada para esta visita
    return [{ customer: c, last }];
  });
}

export async function runReturnInvites(biz: Biz & { returnEnabled: boolean }) {
  const result = { planned: 0, sent: 0, waiting: 0 };
  if (!biz.returnEnabled) return result;
  const now = new Date();
  const list = await eligible(biz, now);

  // 1) Agenda um horário aleatório para quem acabou de ficar elegível (ou cujo plano ficou vencido/velho).
  const windowStart = localToDate(localDate(now), biz.returnWindowStart).getTime();
  const windowEnd = localToDate(localDate(now), biz.returnWindowEnd).getTime();
  const inWindow = now.getTime() >= windowStart && now.getTime() <= windowEnd;
  for (const { customer, last } of list) {
    const stale = !customer.returnDueAt || customer.returnDueAt < last.startsAt;
    const missed = customer.returnDueAt && customer.returnDueAt < now && !inWindow; // passou do horário e a janela fechou
    if (stale || missed) {
      await db.customer.update({ where: { phone: customer.phone }, data: { returnDueAt: planSendTime(biz, now) } });
      result.planned++;
    }
  }

  // 2) Envia os que já chegaram na hora planejada, poucos por vez e com pausas aleatórias entre eles.
  if (!inWindow) return result;
  const startOfDay = localToDate(localDate(now), 0);
  const sentToday = await db.customer.count({ where: { returnSentAt: { gte: startOfDay } } });
  const due = list
    .filter(({ customer }) => customer.returnDueAt && customer.returnDueAt <= now)
    .sort((a, b) => a.customer.returnDueAt!.getTime() - b.customer.returnDueAt!.getTime());
  const room = Math.max(0, Math.min(MAX_PER_RUN, MAX_PER_DAY - sentToday));
  result.waiting = Math.max(0, due.length - room);

  for (const { customer, last } of due.slice(0, room)) {
    if (result.sent > 0) await sleep(rand(5_000, 20_000));
    const text = renderTemplate(pickVariant(biz.returnTemplate), {
      cliente: customer.name,
      negocio: biz.name,
      servico: last.items.map((i) => i.name).join(" + ") || "seu atendimento",
      startsAt: last.startsAt,
      dias: Math.floor((Date.now() - last.startsAt.getTime()) / DAY),
    });
    const ok = await sendText(customer.phone, text, { customerId: customer.phone });
    if (ok) {
      await db.customer.update({ where: { phone: customer.phone }, data: { returnSentAt: new Date() } });
      result.sent++;
    } else {
      // Sem WhatsApp conectado ou falha: tenta de novo mais tarde, em outro horário.
      await db.customer.update({ where: { phone: customer.phone }, data: { returnDueAt: new Date(Date.now() + rand(30, 90) * 60_000) } });
    }
  }
  return result;
}
