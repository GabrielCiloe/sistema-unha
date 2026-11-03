"use client";

import { Copy } from "lucide-react";
import { Switch } from "@/components/switch";
import { DAY_KEYS, DAY_NAMES, fromTime, planRanges, toTime, type DayKey, type DayPlan, type Schedule } from "@/lib/schedule";

// Configurações > Horários: um bloco por dia, com abertura, almoço (opcional) e fechamento.
// "Aplicar a todos" copia o dia para a semana inteira; cada dia pode ser ajustado depois.
export function ScheduleEditor({ value, onChange }: { value: Schedule; onChange: (s: Schedule) => void }) {
  const set = (k: DayKey, patch: Partial<DayPlan>) => onChange({ ...value, [k]: { ...value[k]!, ...patch } });
  const applyAll = (k: DayKey) => {
    const src = value[k]!;
    const next: Schedule = {};
    for (const d of DAY_KEYS) next[d] = { ...src, on: d === k ? src.on : value[d]!.on };
    onChange(next);
  };

  return (
    <div className="grid gap-3">
      {DAY_KEYS.map((k) => {
        const p = value[k]!;
        const problem = p.on && planRanges(p).length === 0 ? "O fechamento precisa ser depois da abertura." : p.on && p.lunchStart != null && p.lunchEnd != null && planRanges(p).length === 1 ? "Almoço fora do expediente ou invertido: será ignorado." : "";
        return (
          <div key={k} className={`rounded-xl border border-line p-3 ${p.on ? "" : "opacity-60"}`}>
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium">{DAY_NAMES[Number(k)]}</p>
              <div className="flex items-center gap-2">
                <button type="button" className="btn-ghost px-2.5 py-1.5 text-xs" title="Aplicar estes horários a todos os dias" onClick={() => applyAll(k)}><Copy size={13} /> Aplicar a todos</button>
                <Switch label={`Atende ${DAY_NAMES[Number(k)]}`} checked={p.on} onChange={(v) => set(k, { on: v })} />
              </div>
            </div>
            <div className={`mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 ${p.on ? "" : "pointer-events-none"}`}>
              <Time id={`o${k}`} label="Abertura" value={p.open} onChange={(v) => set(k, { open: v ?? p.open })} />
              <Time id={`ls${k}`} label="Almoço (início)" value={p.lunchStart} onChange={(v) => set(k, { lunchStart: v })} optional />
              <Time id={`le${k}`} label="Almoço (fim)" value={p.lunchEnd} onChange={(v) => set(k, { lunchEnd: v })} optional />
              <Time id={`c${k}`} label="Fechamento" value={p.close} onChange={(v) => set(k, { close: v ?? p.close })} />
            </div>
            {problem && <p className="mt-2 text-xs text-amber-300">{problem}</p>}
          </div>
        );
      })}
      <p className="text-xs text-muted">Deixe o almoço em branco para atender direto. Os horários oferecidos seguem o intervalo abaixo, contando a partir da abertura de cada período.</p>
    </div>
  );
}

function Time({ id, label, value, onChange, optional = false }: { id: string; label: string; value: number | null; onChange: (v: number | null) => void; optional?: boolean }) {
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <input id={id} type="time" step={300} className="input" value={toTime(value)} onChange={(e) => onChange(fromTime(e.target.value))} required={!optional} />
    </div>
  );
}
