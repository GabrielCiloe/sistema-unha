import { db } from "./db";

// Brasil (sem horário de verão desde 2019): offset fixo -03:00.
const TZ_OFFSET_MIN = -180;
export const HOLD_MINUTES = 30;
export const MIN_LEAD_MINUTES = 30; // antecedência mínima para reservar
const MIN = 60_000;

export const localToDate = (dateStr: string, minutes: number) => {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, minutes - TZ_OFFSET_MIN));
};

export const weekdayOf = (dateStr: string) => {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

export type SlotBiz = {
  workDays: number[];
  openMinutes: number;
  closeMinutes: number;
  slotStepMinutes: number;
  bufferMinutes: number;
};

// Horários que seguram vaga: confirmados/concluídos, ou pendentes ainda dentro da janela de retenção
// (ou com comprovante em análise). `bufferMin` amplia a checagem pela pausa entre atendimentos.
export function blockingWhere(from: Date, to: Date, bufferMin = 0) {
  const holdLimit = new Date(Date.now() - HOLD_MINUTES * MIN);
  return {
    startsAt: { lt: new Date(to.getTime() + bufferMin * MIN) },
    endsAt: { gt: new Date(from.getTime() - bufferMin * MIN) },
    OR: [
      { status: { in: ["CONFIRMED", "COMPLETED"] as ("CONFIRMED" | "COMPLETED")[] } },
      {
        status: "PENDING_PAYMENT" as const,
        OR: [{ createdAt: { gt: holdLimit } }, { payments: { some: { status: "IN_REVIEW" as const } } }],
      },
    ],
  };
}

export type DayReason = "closed" | "too_long" | "full" | "passed";
export type DayResult = { slots: string[]; reason: DayReason | null };

type Busy = { startsAt: Date; endsAt: Date };

// Calcula os horários do dia a partir dos PERÍODOS LIVRES: o primeiro horário de cada período começa
// exatamente quando o anterior termina (ou na abertura), sem "buracos" de grade fixa.
export function daySlots(biz: SlotBiz, dateStr: string, duration: number, busy: Busy[], nowMs: number): DayResult {
  if (!biz.workDays.includes(weekdayOf(dateStr))) return { slots: [], reason: "closed" };

  const open = localToDate(dateStr, biz.openMinutes).getTime();
  const close = localToDate(dateStr, biz.closeMinutes).getTime();
  const dur = duration * MIN;
  const buffer = biz.bufferMinutes * MIN;
  const step = biz.slotStepMinutes * MIN;
  if (dur > close - open) return { slots: [], reason: "too_long" };

  // Ocupado = atendimento + pausa depois dele; junta sobreposições e recorta no expediente.
  const blocks = busy
    .map((b) => [Math.max(b.startsAt.getTime(), open), Math.min(b.endsAt.getTime() + buffer, close)] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const blk of blocks) {
    const last = merged[merged.length - 1];
    if (last && blk[0] <= last[1]) last[1] = Math.max(last[1], blk[1]);
    else merged.push([...blk]);
  }

  // Períodos livres entre os bloqueios.
  const free: [number, number][] = [];
  let cursor = open;
  for (const [a, b] of merged) {
    if (a > cursor) free.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (cursor < close) free.push([cursor, close]);

  const earliest = nowMs + MIN_LEAD_MINUTES * MIN;
  const all: number[] = [];
  for (const [a, b] of free) {
    // O serviço precisa caber; se o período termina num atendimento, também respeita a pausa antes dele.
    const need = dur + (b === close ? 0 : buffer);
    for (let s = a; s + need <= b; s += step) all.push(s);
    // Também oferece o horário que termina exatamente quando o próximo atendimento (ou o fechamento) começa:
    // evita deixar um "buraco" sem uso antes de um agendamento.
    const last = b - need;
    if (last >= a && (last - a) % step !== 0) all.push(last);
  }
  all.sort((x, y) => x - y);

  if (all.length === 0) return { slots: [], reason: "full" };
  const future = all.filter((s) => s >= earliest);
  if (future.length === 0) return { slots: [], reason: "passed" };
  return { slots: future.map((s) => new Date(s).toISOString()), reason: null };
}

export async function loadBiz() {
  return db.business.findUnique({ where: { id: "main" } });
}

// Carrega de uma vez os atendimentos que bloqueiam o período (para vários dias).
export async function loadBusy(from: Date, to: Date, bufferMin: number): Promise<Busy[]> {
  return db.appointment.findMany({
    where: blockingWhere(from, to, bufferMin),
    select: { startsAt: true, endsAt: true },
  });
}

export async function availableSlots(dateStr: string, durationMin: number): Promise<DayResult> {
  const biz = await loadBiz();
  if (!biz) return { slots: [], reason: "closed" };
  const busy = await loadBusy(localToDate(dateStr, 0), localToDate(dateStr, 24 * 60), biz.bufferMinutes);
  return daySlots(biz, dateStr, durationMin, busy, Date.now());
}

// Disponibilidade de vários dias com uma única consulta ao banco.
export async function availabilityForDays(dates: string[], durationMin: number) {
  const biz = await loadBiz();
  if (!biz || dates.length === 0) return { biz, days: [] as { date: string; count: number; reason: DayReason | null }[] };
  const busy = await loadBusy(localToDate(dates[0], 0), localToDate(dates[dates.length - 1], 24 * 60), biz.bufferMinutes);
  const now = Date.now();
  return {
    biz,
    days: dates.map((date) => {
      const r = daySlots(biz, date, durationMin, busy, now);
      return { date, count: r.slots.length, reason: r.reason };
    }),
  };
}

export const fmtMinutes = (m: number) => {
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h === 0 ? `${r} min` : r === 0 ? `${h}h` : `${h}h${String(r).padStart(2, "0")}`;
};

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// Texto para a cliente explicando por que não há horário.
export function reasonMessage(reason: DayReason, durationMin: number, biz: SlotBiz) {
  switch (reason) {
    case "closed":
      return "Não atendemos neste dia da semana. Escolha outra data.";
    case "too_long":
      return `Os serviços escolhidos somam ${fmtMinutes(durationMin)}, mas o expediente (${hhmm(biz.openMinutes)} às ${hhmm(biz.closeMinutes)}) tem ${fmtMinutes(biz.closeMinutes - biz.openMinutes)}. Escolha menos serviços para agendar.`;
    case "full":
      return `Não há um intervalo livre de ${fmtMinutes(durationMin)} seguidos neste dia (agenda cheia ou o que resta é menor que o tempo dos serviços). Tente outra data ou escolha menos serviços.`;
    case "passed":
      return "Os horários desta data já passaram. Escolha outra data.";
  }
}
