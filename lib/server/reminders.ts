import { pickVariant } from "./returns";
import { db } from "./db";
import { localToDate, todayLocal } from "./slots";
import { sendText } from "./whatsapp";
import { mapsUrl, renderTemplate } from "@/lib/templates";
import { DEFAULT_REMINDER_TEMPLATE } from "@/lib/defaults";

// Lembretes espalhados e aleatórios (anti-bloqueio do WhatsApp):
// - cada agendamento recebe um horário sorteado em volta de "reminderHours" antes (± JITTER), dentro da janela de envio;
// - a cada execução do cron saem no máximo MAX_PER_RUN, com pausas aleatórias entre eles;
// - o texto do lembrete pode ter várias versões separadas por "---" (sorteadas), como nos convites de retorno.
const JITTER_MIN = 90; // minutos para mais ou para menos em volta do horário-alvo
const MAX_PER_RUN = 4;
const SEND_WINDOW = { start: 8 * 60, end: 21 * 60 }; // só envia entre 08:00 e 21:00 (hora local)
const MIN = 60_000;

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Biz = { name: string; reminderHours: number; reminderTemplate: string; address: string; latitude: number | null; longitude: number | null };

// Horário sorteado para o lembrete: alvo = início - reminderHours, deslocado aleatoriamente,
// recortado para a janela de envio (se cair de madrugada, vai para o começo da janela do dia seguinte).
export function planReminderTime(startsAt: Date, reminderHours: number, now = new Date()) {
  const target = startsAt.getTime() - reminderHours * 3600_000 + rand(-JITTER_MIN, JITTER_MIN) * MIN;
  let t = new Date(Math.max(target, now.getTime() + 2 * MIN));
  const day = todayLocal(t.getTime());
  const open = localToDate(day, SEND_WINDOW.start).getTime();
  const close = localToDate(day, SEND_WINDOW.end).getTime();
  if (t.getTime() < open) t = new Date(open + rand(0, 45) * MIN);
  else if (t.getTime() > close) {
    const next = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8)) + 1)).toISOString().slice(0, 10);
    t = new Date(localToDate(next, SEND_WINDOW.start).getTime() + rand(0, 45) * MIN);
  }
  // Nunca depois do próprio atendimento (agendamentos feitos em cima da hora recebem o lembrete logo).
  if (t.getTime() > startsAt.getTime() - 30 * MIN) t = new Date(Math.max(now.getTime() + 2 * MIN, startsAt.getTime() - rand(45, 120) * MIN));
  return t;
}

export async function runReminders(biz: Biz) {
  const now = new Date();
  const result = { planned: 0, sent: 0, waiting: 0 };

  // 1) Planeja quem ainda não tem horário sorteado e já está dentro da faixa (reminderHours + folga).
  const horizon = new Date(now.getTime() + (biz.reminderHours + 6) * 3600_000);
  const unplanned = await db.appointment.findMany({
    where: { status: "CONFIRMED", reminderSentAt: null, reminderDueAt: null, startsAt: { gt: now, lte: horizon } },
    select: { id: true, startsAt: true },
  });
  for (const a of unplanned) {
    await db.appointment.update({ where: { id: a.id }, data: { reminderDueAt: planReminderTime(a.startsAt, biz.reminderHours, now) } });
    result.planned++;
  }

  // 2) Envia os que chegaram na hora, poucos por vez, com pausas aleatórias.
  const due = await db.appointment.findMany({
    where: { status: "CONFIRMED", reminderSentAt: null, reminderDueAt: { lte: now }, startsAt: { gt: now } },
    orderBy: { reminderDueAt: "asc" },
    include: { customer: true, items: true },
  });
  result.waiting = Math.max(0, due.length - MAX_PER_RUN);
  for (const a of due.slice(0, MAX_PER_RUN)) {
    if (result.sent > 0) await sleep(rand(4_000, 15_000));
    const text = renderTemplate(pickVariant(biz.reminderTemplate, DEFAULT_REMINDER_TEMPLATE), {
      cliente: a.customer.name,
      negocio: biz.name,
      servico: a.items.map((i) => i.name).join(" + "),
      startsAt: a.startsAt,
      endereco: biz.address,
      mapa: mapsUrl(biz.latitude, biz.longitude),
    });
    // Marca antes de enviar: falha de envio fica no histórico, sem reenviar em loop.
    await db.appointment.update({ where: { id: a.id }, data: { reminderSentAt: new Date() } });
    if (await sendText(a.customer.phone, text, { customerId: a.customerId, appointmentId: a.id })) result.sent++;
  }
  return result;
}
