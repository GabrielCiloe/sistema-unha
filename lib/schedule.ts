// Horários de atendimento por dia da semana (Configurações > Horários). Funções puras: servidor e tela.
// Cada dia tem abertura, pausa de almoço (opcional) e fechamento, em minutos desde 00:00.

export type DayPlan = { on: boolean; open: number; lunchStart: number | null; lunchEnd: number | null; close: number };
export type DayKey = "0" | "1" | "2" | "3" | "4" | "5" | "6";
export type Schedule = Partial<Record<DayKey, DayPlan>>;
export const DAY_KEYS: DayKey[] = ["0", "1", "2", "3", "4", "5", "6"];
export const DAY_NAMES = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

type Legacy = { workDays: number[]; openMinutes: number; closeMinutes: number };
type BizLike = Legacy & { schedule?: unknown };

const isPlan = (p: unknown): p is DayPlan =>
  !!p && typeof p === "object" && typeof (p as DayPlan).on === "boolean" && typeof (p as DayPlan).open === "number" && typeof (p as DayPlan).close === "number";

// Períodos de atendimento do dia ([início, fim] em minutos). Com almoço válido, são dois períodos.
export function planRanges(p: DayPlan): [number, number][] {
  if (!p.on || p.close <= p.open) return [];
  const hasLunch = p.lunchStart != null && p.lunchEnd != null && p.lunchStart > p.open && p.lunchEnd < p.close && p.lunchEnd > p.lunchStart;
  return hasLunch ? [[p.open, p.lunchStart!], [p.lunchEnd!, p.close]] : [[p.open, p.close]];
}

// Grade salva, ou a antiga (dias + abertura/fechamento iguais para todos) quando o dia não foi configurado.
export function readSchedule(biz: BizLike): Schedule {
  const raw = biz.schedule && typeof biz.schedule === "object" ? (biz.schedule as Record<string, unknown>) : {};
  const out: Schedule = {};
  for (const k of DAY_KEYS) {
    const p = raw[k];
    out[k] = isPlan(p) ? p : { on: biz.workDays.includes(Number(k)), open: biz.openMinutes, lunchStart: null, lunchEnd: null, close: biz.closeMinutes };
  }
  return out;
}

// Períodos de uma data: ajuste próprio (biz.overrides[data]) ou a grade do dia da semana.
export function rangesForDate(biz: BizLike & { overrides?: Record<string, DayPlan> }, dateStr: string) {
  const o = biz.overrides?.[dateStr];
  if (o) return planRanges(o);
  const [y, m, d] = dateStr.split("-").map(Number);
  return dayRanges(biz, new Date(Date.UTC(y, m - 1, d)).getUTCDay());
}

export const dayRanges = (biz: BizLike, weekday: number) => planRanges(readSchedule(biz)[String(weekday) as DayKey]!);

// Maior período contínuo da semana (para explicar quando os serviços não cabem em nenhum dia).
export function longestRange(biz: BizLike) {
  let best: [number, number] | null = null;
  for (const k of DAY_KEYS) for (const r of planRanges(readSchedule(biz)[k]!)) if (!best || r[1] - r[0] > best[1] - best[0]) best = r;
  return best;
}

// Resumo compatível com os campos antigos (dias de atendimento, primeira abertura e último fechamento).
export function summarize(s: Schedule): Legacy {
  const days = DAY_KEYS.filter((k) => planRanges(s[k]!).length > 0);
  const ranges = days.flatMap((k) => planRanges(s[k]!));
  return {
    workDays: days.map(Number),
    openMinutes: ranges.length ? Math.min(...ranges.map((r) => r[0])) : 540,
    closeMinutes: ranges.length ? Math.max(...ranges.map((r) => r[1])) : 1080,
  };
}

export const toTime = (m: number | null) => (m == null ? "" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
export const fromTime = (t: string): number | null => {
  if (!/^\d{2}:\d{2}$/.test(t)) return null;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
