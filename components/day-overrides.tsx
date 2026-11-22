"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/modal";
import { Switch } from "@/components/switch";
import { toast } from "@/components/toast";
import { api } from "@/lib/client";
import { DAY_NAMES, fromTime, planRanges, toTime, type DayKey, type DayPlan, type Schedule } from "@/lib/schedule";

// Configurações > "Ajustes por dia": calendário do mês; cada dia mostra o horário que vale (grade da semana
// ou ajuste próprio). Clicar abre o popup para fechar o dia, mudar abertura/almoço/fechamento, aplicar à
// semana inteira ou voltar ao padrão. Os ajustes são salvos na hora (não dependem do botão Salvar).
type Override = DayPlan & { date: string };

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const WEEK = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const todayStr = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date());
const hhmm = (m: number) => toTime(m);
const summary = (p: DayPlan) => {
  const r = planRanges(p);
  return r.length ? r.map(([a, b]) => `${hhmm(a)}–${hhmm(b)}`).join(" · ") : "Fechado";
};

export function DayOverrides({ schedule }: { schedule: Schedule }) {
  const today = todayStr();
  const [cursor, setCursor] = useState({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 });
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [editing, setEditing] = useState<string | null>(null);

  const cells = useMemo(() => {
    const offset = new Date(Date.UTC(cursor.y, cursor.m, 1)).getUTCDay();
    return Array.from({ length: 42 }, (_, i) => new Date(Date.UTC(cursor.y, cursor.m, 1 - offset + i)).toISOString().slice(0, 10));
  }, [cursor]);

  async function load() {
    try {
      const r = await api<{ overrides: Override[] }>(`/api/admin/schedule?from=${cells[0]}&to=${cells[41]}`);
      setOverrides(Object.fromEntries(r.overrides.map((o) => [o.date, o])));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Erro", false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells]);

  const planFor = (date: string): DayPlan => {
    const o = overrides[date];
    if (o) return o;
    const wd = String(new Date(`${date}T12:00:00Z`).getUTCDay()) as DayKey;
    return schedule[wd] ?? { on: false, open: 540, lunchStart: null, lunchEnd: null, close: 1080 };
  };
  const move = (delta: number) => setCursor(({ y, m }) => {
    const d = new Date(Date.UTC(y, m + delta, 1));
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
  });

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="font-medium first-letter:uppercase">{MONTHS[cursor.m]} de {cursor.y}</p>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-ghost px-3" aria-label="Mês anterior" onClick={() => move(-1)}><ChevronLeft size={16} /></button>
          <button type="button" className="btn-ghost" onClick={() => setCursor({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 })}>Hoje</button>
          <button type="button" className="btn-ghost px-3" aria-label="Próximo mês" onClick={() => move(1)}><ChevronRight size={16} /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-line bg-line text-center">
        {WEEK.map((d) => <div key={d} className="bg-surface-2 py-2 text-xs font-medium text-muted">{d}</div>)}
        {cells.map((k) => {
          const inMonth = Number(k.slice(5, 7)) - 1 === cursor.m;
          const p = planFor(k);
          const custom = Boolean(overrides[k]);
          const closed = planRanges(p).length === 0;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setEditing(k)}
              aria-label={`${k.slice(8)}/${k.slice(5, 7)}: ${summary(p)}${custom ? " (ajustado)" : ""}`}
              className={`min-h-[64px] p-1 text-left align-top transition hover:bg-surface-2 sm:min-h-[80px] sm:p-1.5 ${inMonth ? "bg-surface" : "bg-background"} ${custom ? "ring-1 ring-inset ring-brand" : ""}`}
            >
              <span className={`inline-flex size-6 items-center justify-center rounded-full text-xs ${k === today ? "bg-brand font-semibold text-on-brand" : inMonth ? "text-ink" : "text-muted/60"}`}>{Number(k.slice(8))}</span>
              <span className={`mt-1 block text-[11px] leading-tight ${closed ? "text-red-300" : "text-muted"}`}>{summary(p)}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted">Dias com borda colorida têm horário próprio. Os demais seguem os horários padrão abaixo. Clique num dia para ajustar.</p>

      {editing && (
        <DayEditor
          date={editing}
          initial={planFor(editing)}
          custom={Boolean(overrides[editing])}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function DayEditor({ date, initial, custom, onClose, onSaved }: { date: string; initial: DayPlan; custom: boolean; onClose: () => void; onSaved: () => void }) {
  const [p, setP] = useState<DayPlan>({ ...initial });
  const [busy, setBusy] = useState(false);
  const label = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "long", day: "2-digit", month: "long" }).format(new Date(`${date}T12:00:00Z`));
  const weekday = DAY_NAMES[new Date(`${date}T12:00:00Z`).getUTCDay()];
  const invalid = p.on && planRanges(p).length === 0;

  async function save(plan: DayPlan | null, week = false) {
    setBusy(true);
    try {
      await api("/api/admin/schedule", { method: "PUT", body: { date, plan, week } });
      toast(plan === null ? (week ? "Semana voltou ao padrão." : "Dia voltou ao padrão da semana.") : week ? "Horários aplicados à semana inteira." : "Horário do dia salvo.");
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Erro", false);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={label.charAt(0).toUpperCase() + label.slice(1)}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          {custom && <button type="button" className="btn-ghost" disabled={busy} onClick={() => save(null)}>Voltar ao padrão ({weekday})</button>}
          <button type="button" className="btn-ghost" disabled={busy || invalid} onClick={() => save(p, true)}>Aplicar à semana inteira</button>
          <button type="button" className="btn-primary" disabled={busy || invalid} onClick={() => save(p)}>Salvar este dia</button>
        </div>
      }
    >
      <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-line bg-background p-3.5">
        <div>
          <p className="text-sm font-medium">Atende neste dia</p>
          <p className="text-xs text-muted">{custom ? "Este dia tem horário próprio." : `Padrão de ${weekday.toLowerCase()}.`}</p>
        </div>
        <Switch label="Atende neste dia" checked={p.on} onChange={(v) => setP({ ...p, on: v })} />
      </div>
      <div className={`grid grid-cols-2 gap-3 ${p.on ? "" : "pointer-events-none opacity-50"}`}>
        <T id="d-open" label="Abertura" value={p.open} onChange={(v) => setP({ ...p, open: v ?? p.open })} />
        <T id="d-close" label="Fechamento" value={p.close} onChange={(v) => setP({ ...p, close: v ?? p.close })} />
        <T id="d-ls" label="Almoço (início)" value={p.lunchStart} onChange={(v) => setP({ ...p, lunchStart: v })} optional />
        <T id="d-le" label="Almoço (fim)" value={p.lunchEnd} onChange={(v) => setP({ ...p, lunchEnd: v })} optional />
      </div>
      {invalid && <p className="mt-2 text-xs text-amber-300">O fechamento precisa ser depois da abertura.</p>}
      <p className="mt-3 text-xs text-muted">Resultado: {summary(p)}. &quot;Aplicar à semana inteira&quot; grava este horário de domingo a sábado desta semana.</p>
    </Modal>
  );
}

function T({ id, label, value, onChange, optional = false }: { id: string; label: string; value: number | null; onChange: (v: number | null) => void; optional?: boolean }) {
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <input id={id} type="time" step={300} className="input" value={toTime(value)} onChange={(e) => onChange(fromTime(e.target.value))} required={!optional} />
    </div>
  );
}
