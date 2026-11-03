import { db } from "./db";
import { longestRange, rangesForDate, type DayPlan } from "@/lib/schedule";

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
  minLeadDays: number;
  schedule?: unknown; // grade por dia (lib/schedule.ts); sem ela valem workDays/openMinutes/closeMinutes
  overrides?: Record<string, DayPlan>; // ajustes por data (DayOverride), carregados por loadBiz
};

export const todayLocal = (nowMs: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date(nowMs));
export const addDays = (dateStr: string, n: number) => {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
// Primeiro instante em que a cliente pode agendar: inicio do dia (hoje + minLeadDays) no fuso local.
export const leadStart = (biz: Pick<SlotBiz, "minLeadDays">, nowMs = Date.now()) => localToDate(addDays(todayLocal(nowMs), biz.minLeadDays), 0);
export const fmtDay = (dateStr: string) => `${dateStr.slice(8)}/${dateStr.slice(5, 7)}`;

// Horários que seguram vaga: confirmados/concluídos, ou pendentes dentro do prazo do sinal (holdUntil)
// ou com comprovante em análise. `bufferMin` amplia a checagem pela pausa entre atendimentos.
export function blockingWhere(from: Date, to: Date, bufferMin = 0) {
  const now = new Date();
  return {
    startsAt: { lt: new Date(to.getTime() + bufferMin * MIN) },
    endsAt: { gt: new Date(from.getTime() - bufferMin * MIN) },
    OR: [
      { status: { in: ["CONFIRMED", "COMPLETED"] as ("CONFIRMED" | "COMPLETED")[] } },
      {
        status: "PENDING_PAYMENT" as const,
        OR: [{ holdUntil: { gt: now } }, { payments: { some: { status: "IN_REVIEW" as const } } }],
      },
    ],
  };
}

export type DayReason = "closed" | "too_long" | "full" | "passed" | "too_soon";
export type DayResult = { slots: string[]; reason: DayReason | null };

type Busy = { startsAt: Date; endsAt: Date };

// Calcula os horários do dia numa GRADE FIXA a partir da abertura (ex.: 09:00, 09:30, 10:00...), de
// slotStepMinutes em slotStepMinutes. Um horário é oferecido quando o serviço (e a pausa) cabe num período livre.
// Assim a cliente, o reagendamento e a listagem da dona mostram sempre os mesmos horários padronizados.
export function daySlots(biz: SlotBiz, dateStr: string, duration: number, busy: Busy[], nowMs: number): DayResult {
  const ranges = rangesForDate(biz, dateStr);
  if (ranges.length === 0) return { slots: [], reason: "closed" };

  const dur = duration * MIN;
  const buffer = biz.bufferMinutes * MIN;
  const step = biz.slotStepMinutes * MIN;
  const spans = ranges.map(([o, c]) => [localToDate(dateStr, o).getTime(), localToDate(dateStr, c).getTime()] as [number, number]);
  if (spans.every(([open, close]) => dur > close - open)) return { slots: [], reason: "too_long" };

  const all: number[] = [];
  for (const [open, close] of spans) {
    // Ocupado = atendimento + pausa depois dele; junta sobreposições e recorta no período.
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
    const free: [number, number][] = [];
    let cursor = open;
    for (const [a, b] of merged) {
      if (a > cursor) free.push([cursor, a]);
      cursor = Math.max(cursor, b);
    }
    if (cursor < close) free.push([cursor, close]);
    // Grade fixa a partir da abertura do período; o serviço (e a pausa) precisa caber num trecho livre.
    for (let s = open; s + dur <= close; s += step) {
      if (free.some(([a, b]) => s >= a && s + dur + (b === close ? 0 : buffer) <= b)) all.push(s);
    }
  }

  // Antecedência mínima: alguns minutos a partir de agora e, se configurado, só a partir de hoje + N dias.
  const earliest = Math.max(nowMs + MIN_LEAD_MINUTES * MIN, leadStart(biz, nowMs).getTime());
  if (all.length === 0) return { slots: [], reason: "full" };
  const future = all.filter((s) => s >= earliest);
  const lastClose = spans[spans.length - 1][1];
  if (future.length === 0) return { slots: [], reason: lastClose <= leadStart(biz, nowMs).getTime() && biz.minLeadDays > 0 ? "too_soon" : "passed" };
  return { slots: future.map((s) => new Date(s).toISOString()), reason: null };
}

// Estúdio + ajustes por data do período pedido (para a grade do dia considerar dias fechados/alterados).
export async function loadBiz(from?: string, to?: string) {
  const biz = await db.business.findUnique({ where: { id: "main" } });
  if (!biz) return null;
  const overrides: Record<string, DayPlan> = {};
  if (from) {
    const rows = await db.dayOverride.findMany({ where: { date: { gte: from, lte: to ?? from } } });
    for (const r of rows) overrides[r.date] = { on: r.on, open: r.open, lunchStart: r.lunchStart, lunchEnd: r.lunchEnd, close: r.close };
  }
  return { ...biz, overrides };
}

// Reagendamento pelo estúdio: sem a antecedência mínima em dias e sem contar o próprio atendimento como ocupado.
export type SlotOpts = { ignoreLead?: boolean; excludeId?: string };
const applyOpts = <B extends SlotBiz>(biz: B, opts?: SlotOpts): B => (opts?.ignoreLead ? { ...biz, minLeadDays: 0 } : biz);

// Carrega de uma vez os atendimentos que bloqueiam o período (para vários dias).
export async function loadBusy(from: Date, to: Date, bufferMin: number, excludeId?: string): Promise<Busy[]> {
  return db.appointment.findMany({
    where: { ...blockingWhere(from, to, bufferMin), ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { startsAt: true, endsAt: true },
  });
}

export async function availableSlots(dateStr: string, durationMin: number, opts?: SlotOpts): Promise<DayResult> {
  const biz = await loadBiz(dateStr);
  if (!biz) return { slots: [], reason: "closed" };
  const busy = await loadBusy(localToDate(dateStr, 0), localToDate(dateStr, 24 * 60), biz.bufferMinutes, opts?.excludeId);
  return daySlots(applyOpts(biz, opts), dateStr, durationMin, busy, Date.now());
}

// Disponibilidade de vários dias com uma única consulta ao banco.
export async function availabilityForDays(dates: string[], durationMin: number, opts?: SlotOpts) {
  const loaded = dates.length ? await loadBiz(dates[0], dates[dates.length - 1]) : null;
  if (!loaded || dates.length === 0) return { biz: loaded, days: [] as { date: string; count: number; reason: DayReason | null }[] };
  const biz = applyOpts(loaded, opts);
  const busy = await loadBusy(localToDate(dates[0], 0), localToDate(dates[dates.length - 1], 24 * 60), biz.bufferMinutes, opts?.excludeId);
  const now = Date.now();
  return {
    biz,
    days: dates.map((date) => {
      const r = daySlots(biz, date, durationMin, busy, now);
      return { date, count: r.slots.length, reason: r.reason };
    }),
  };
}

// Períodos livres do dia (expediente menos atendimentos + pausa) e os horários da grade: a dona vê onde cabe um encaixe.
export async function freePeriods(dateStr: string) {
  const biz = await loadBiz(dateStr);
  const empty = { closed: true, periods: [] as { from: string; to: string; minutes: number }[], slots: [] as string[] };
  if (!biz) return empty;
  const ranges = rangesForDate(biz, dateStr);
  if (ranges.length === 0) return empty;
  const buffer = biz.bufferMinutes * MIN;
  const busy = await loadBusy(localToDate(dateStr, 0), localToDate(dateStr, 24 * 60), biz.bufferMinutes);
  const periods: { from: string; to: string; minutes: number }[] = [];
  for (const [o, c] of ranges) {
    const open = localToDate(dateStr, o).getTime();
    const close = localToDate(dateStr, c).getTime();
    const blocks = busy
      .map((b) => [Math.max(b.startsAt.getTime(), open), Math.min(b.endsAt.getTime() + buffer, close)] as [number, number])
      .filter(([a, b]) => b > a)
      .sort((x, y) => x[0] - y[0]);
    let cursor = open;
    const push = (a: number, b: number) => b - a >= biz.slotStepMinutes * MIN && periods.push({ from: new Date(a).toISOString(), to: new Date(b).toISOString(), minutes: Math.round((b - a) / MIN) });
    for (const [a, b] of blocks) {
      if (a > cursor) push(cursor, a);
      cursor = Math.max(cursor, b);
    }
    if (cursor < close) push(cursor, close);
  }
  const slots = daySlots({ ...biz, minLeadDays: 0 }, dateStr, biz.slotStepMinutes, busy, Date.now()).slots;
  return { closed: false, periods, slots };
}

export const fmtMinutes = (m: number) => {
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h === 0 ? `${r} min` : r === 0 ? `${h}h` : `${h}h${String(r).padStart(2, "0")}`;
};

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// Texto para a cliente explicando por que não há horário.
export function reasonMessage(reason: DayReason, durationMin: number, biz: SlotBiz, nowMs = Date.now()) {
  switch (reason) {
    case "closed":
      return "Não atendemos neste dia da semana. Escolha outra data.";
    case "too_long": {
      const r = longestRange(biz);
      const span = r ? `o maior período de atendimento (${hhmm(r[0])} às ${hhmm(r[1])}) tem ${fmtMinutes(r[1] - r[0])}` : "não há período de atendimento cadastrado";
      return `Os serviços escolhidos somam ${fmtMinutes(durationMin)}, mas ${span}. Escolha menos serviços para agendar.`;
    }
    case "full":
      return `Não há um intervalo livre de ${fmtMinutes(durationMin)} seguidos neste dia (agenda cheia ou o que resta é menor que o tempo dos serviços). Tente outra data ou escolha menos serviços.`;
    case "passed":
      return "Os horários desta data já passaram. Escolha outra data.";
    case "too_soon":
      return `Agendamos com pelo menos ${biz.minLeadDays} ${biz.minLeadDays === 1 ? "dia" : "dias"} de antecedência. O primeiro dia disponível é ${fmtDay(addDays(todayLocal(nowMs), biz.minLeadDays))}.`;
  }
}
