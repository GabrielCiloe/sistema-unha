"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

export type Day = { date: string; available: boolean; reason: string | null; message: string | null };

const todayStr = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date());
const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10); // m = 0..11, aceita d fora do mês

// Calendário mensal (Figma "Data"): D S T Q Q S S, dias com vaga em verde, escolhido em círculo rosé,
// dias de outro mês em cinza claro. Só mostra meses dentro da janela de disponibilidade.
// `initialMonth` (AAAA-MM, opcional): mês mostrado ao montar quando ainda não há `value` (ex.: data vinda da agenda).
export function MonthCalendar({ days, value, onChange, initialMonth }: { days: Day[]; value: string; onChange: (d: string) => void; initialMonth?: string }) {
  const today = todayStr();
  const last = days[days.length - 1]?.date ?? today;
  const [ym, setYm] = useState(() => (value || initialMonth || today).slice(0, 7));
  const [y, m] = ym.split("-").map(Number);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const first = new Date(Date.UTC(y, m - 1, 1));
  const startOffset = first.getUTCDay();
  const cells = Array.from({ length: 42 }, (_, i) => {
    const date = iso(y, m - 1, i - startOffset + 1);
    return { date, inMonth: date.slice(0, 7) === ym, day: Number(date.slice(8)) };
  });
  const rows = cells.filter((_, i) => i < 35 || cells.slice(35).some((c) => c.inMonth)); // 6ª linha só se o mês precisar
  const prevYm = iso(y, m - 2, 1).slice(0, 7);
  const nextYm = iso(y, m, 1).slice(0, 7);
  const canPrev = prevYm >= today.slice(0, 7);
  const canNext = nextYm <= last.slice(0, 7);
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button type="button" aria-label="Mês anterior" disabled={!canPrev} onClick={() => setYm(prevYm)} className="rounded-full p-1 text-ink disabled:opacity-25"><ChevronLeft size={20} /></button>
        <span className="text-[14px] font-semibold text-ink">{MONTHS[m - 1]} {y}</span>
        <button type="button" aria-label="Próximo mês" disabled={!canNext} onClick={() => setYm(nextYm)} className="rounded-full p-1 text-ink disabled:opacity-25"><ChevronRight size={20} /></button>
      </div>
      <div className="mb-4 flex items-center justify-center gap-5 text-[12px] text-ink/45">
        <span className="flex items-center gap-1.5"><span className="size-3 rounded-full bg-[#1db954]" aria-hidden /> Dias disponíveis</span>
        <span className="flex items-center gap-1.5"><span className="size-3 rounded-full bg-[#8f1f00]" aria-hidden /> Dias indisponíveis</span>
      </div>
      <div className="grid grid-cols-7 gap-y-2 text-center" role="grid" aria-label="Calendário">
        {["D", "S", "T", "Q", "Q", "S", "S"].map((w, i) => (
          <span key={i} className="text-[16px] text-ink/50">{w}</span>
        ))}
        {rows.map((c) => {
          const info = byDate.get(c.date);
          const available = Boolean(info?.available) && c.inMonth;
          const on = value === c.date;
          const cls = on
            ? "bg-brand text-white font-semibold"
            : !c.inMonth
              ? "text-ink/25"
              : available
                ? "text-[#1db954] font-medium hover:bg-brand/10"
                : "text-[#8f1f00] font-medium";
          return (
            <button
              key={c.date}
              type="button"
              role="gridcell"
              disabled={!available}
              aria-selected={on}
              aria-current={c.date === today ? "date" : undefined}
              title={!available && c.inMonth ? (info?.message ?? undefined) : undefined}
              onClick={() => onChange(c.date)}
              className={`mx-auto flex size-10 items-center justify-center rounded-full text-[16px] leading-none transition disabled:cursor-default ${cls}`}
            >
              {String(c.day).padStart(2, "0")}
            </button>
          );
        })}
      </div>
    </div>
  );
}
