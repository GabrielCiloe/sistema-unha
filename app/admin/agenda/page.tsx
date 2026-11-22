"use client";

import { CalendarClock, ChevronLeft, ChevronRight, Clock, MessageSquare, Plus, QrCode, UserX, XCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageTitle } from "@/components/admin-shell";
import { NewAppointmentModal, type CreatedAppointment } from "@/components/admin/new-appointment-modal";
import { PixDepositModal } from "@/components/admin/pix-deposit-modal";
import { Modal } from "@/components/modal";
import { MonthCalendar, type Day } from "@/components/month-calendar";
import { ApptBadge, PayBadge } from "@/components/status";
import { toast } from "@/components/toast";
import { api, useApi } from "@/lib/client";
import { brl, fmtDateTime, formatPhone } from "@/lib/templates";
import { Skeleton } from "@/components/skeleton";

type Appt = {
  id: string;
  startsAt: string;
  endsAt: string;
  status: string;
  source?: "PUBLIC" | "ADMIN";
  totalCents: number;
  depositCents: number;
  notes: string;
  customer: { name: string; phone: string };
  items: { name: string }[];
  payments: { id: string; status: string; amountCents: number; pixPayload?: string | null }[];
};

const FILTERS = [
  ["", "Todos"],
  ["PENDING_PAYMENT", "Aguardando sinal"],
  ["CONFIRMED", "Confirmados"],
  ["COMPLETED", "Concluídos"],
  ["CANCELLED", "Cancelados"],
] as const;

// Cor de cada situação no calendário (barra lateral do item e ponto no celular).
const TONE: Record<string, string> = {
  PENDING_PAYMENT: "bg-amber-400",
  CONFIRMED: "bg-emerald-400",
  COMPLETED: "bg-sky-400",
  CANCELLED: "bg-red-400",
  NO_SHOW: "bg-zinc-400",
};
const LEGEND = [["PENDING_PAYMENT", "Aguardando sinal"], ["CONFIRMED", "Confirmado"], ["COMPLETED", "Concluído"], ["CANCELLED", "Cancelado"], ["NO_SHOW", "Faltou"]];

const TZ = "America/Sao_Paulo";
const dayKey = (iso: string | Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(new Date(iso));
const time = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const WEEK = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export default function Agenda() {
  const today = dayKey(new Date());
  const [cursor, setCursor] = useState({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 });
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [resched, setResched] = useState<Appt | null>(null);
  const [showFree, setShowFree] = useState(false);
  const [error, setError] = useState("");
  // Popup "Novo agendamento": `date` vem do dia aberto na grade. `created` = atendimento recém-criado, que a agenda
  // abre (e destaca) quando o popup fecha.
  const [creating, setCreating] = useState<{ date?: string } | null>(null);
  const [created, setCreated] = useState<CreatedAppointment | null>(null);
  const [highlight, setHighlight] = useState("");
  const highlightRef = useRef<HTMLLIElement>(null);
  // "Pix do sinal" de um atendimento que ainda aguarda o sinal: reabre o copia e cola.
  const [pixFor, setPixFor] = useState<Appt | null>(null);

  // 6 semanas (42 dias) começando no domingo anterior ao dia 1.
  const cells = useMemo(() => {
    const offset = new Date(Date.UTC(cursor.y, cursor.m, 1)).getUTCDay();
    return Array.from({ length: 42 }, (_, i) => new Date(Date.UTC(cursor.y, cursor.m, 1 - offset + i)).toISOString().slice(0, 10));
  }, [cursor]);

  const path = useMemo(() => {
    const from = new Date(`${cells[0]}T00:00:00-03:00`).toISOString();
    const to = new Date(`${cells[41]}T23:59:59-03:00`).toISOString();
    return `/api/admin/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${filter ? `&status=${filter}` : ""}`;
  }, [cells, filter]);

  const { data, loading, reload, error: loadError } = useApi<{ appointments: Appt[] }>(path);

  const byDay = useMemo(() => {
    const map = new Map<string, Appt[]>();
    for (const a of data?.appointments ?? []) {
      const k = dayKey(a.startsAt);
      map.set(k, [...(map.get(k) ?? []), a]);
    }
    return map;
  }, [data]);

  const move = (delta: number) => setCursor(({ y, m }) => {
    const d = new Date(Date.UTC(y, m + delta, 1));
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
  });

  async function setStatus(a: Appt, status: "CANCELLED" | "NO_SHOW") {
    const msg =
      status === "CANCELLED"
        ? `Cancelar o agendamento de ${a.customer.name}? A cliente será avisada no WhatsApp.${a.payments[0]?.status === "PAID" ? "\n\nO sinal já foi pago e não é devolvido. Se for só mudar a data, use Reagendar." : ""}`
        : `Registrar que ${a.customer.name} não compareceu?`;
    if (!confirm(msg)) return;
    try {
      setError("");
      await api(`/api/admin/appointments/${a.id}`, { method: "PATCH", body: { status } });
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    }
  }

  function closeCreating() {
    setCreating(null);
    if (!created) return;
    setHighlight(created.id);
    setShowFree(false);
    setOpen(dayKey(created.startsAt));
    setCreated(null);
  }

  useEffect(() => {
    if (open && highlight) highlightRef.current?.scrollIntoView({ block: "nearest" });
  }, [open, highlight, data]);

  const dayList = open ? (byDay.get(open) ?? []) : [];
  const openLabel = open
    ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "long", day: "2-digit", month: "long" }).format(new Date(`${open}T12:00:00Z`))
    : "";

  return (
    <>
      <PageTitle title="Agenda" />

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="chips" role="group" aria-label="Filtrar por situação">
          {FILTERS.map(([v, l]) => (
            <button key={v} onClick={() => setFilter(v)} aria-pressed={filter === v} className={filter === v ? "btn-primary" : "btn-ghost"}>{l}</button>
          ))}
        </div>
        <button type="button" className="btn-primary shrink-0" onClick={() => setCreating({})}><Plus size={16} /> Novo agendamento</button>
      </div>
      {(error || loadError) && <p role="alert" className="mb-3 text-sm text-red-300">{error || loadError}</p>}

      <section className="card p-3 sm:p-5" aria-label="Calendário">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold first-letter:uppercase">{MONTHS[cursor.m]} de {cursor.y}</h2>
          <div className="flex items-center gap-2">
            <button className="btn-ghost px-3" aria-label="Mês anterior" onClick={() => move(-1)}><ChevronLeft size={16} /></button>
            <button className="btn-ghost" onClick={() => setCursor({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 })}>Hoje</button>
            <button className="btn-ghost px-3" aria-label="Próximo mês" onClick={() => move(1)}><ChevronRight size={16} /></button>
          </div>
        </div>

        {/* Legenda acima do calendário, para ficar visível sem rolar. */}
        <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-ink" aria-label="Legenda">
          {LEGEND.map(([s, l]) => (
            <li key={s} className="flex items-center gap-1.5"><span className={`size-3 rounded-full ${TONE[s]}`} /> {l}</li>
          ))}
        </ul>

        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-line bg-line text-center">
          {WEEK.map((d) => (
            <div key={d} className="bg-surface-2 py-2 text-xs font-medium text-muted">{d}</div>
          ))}
          {cells.map((k) => {
            const items = byDay.get(k) ?? [];
            const inMonth = Number(k.slice(5, 7)) - 1 === cursor.m;
            const isToday = k === today;
            return (
              <button
                key={k}
                onClick={() => setOpen(k)}
                aria-label={`${k.slice(8)}/${k.slice(5, 7)}: ${items.length} agendamento(s)`}
                className={`min-h-[64px] p-1 text-left align-top transition hover:bg-surface-2 sm:min-h-[104px] sm:p-1.5 ${inMonth ? "bg-surface" : "bg-background"}`}
              >
                <span className={`inline-flex size-6 items-center justify-center rounded-full text-xs ${isToday ? "bg-brand font-semibold text-on-brand" : inMonth ? "text-ink" : "text-muted/60"}`}>{Number(k.slice(8))}</span>

                {/* Desktop: itens com horário e nome. */}
                <span className="mt-1 hidden space-y-1 sm:block">
                  {items.slice(0, 3).map((a) => (
                    <span key={a.id} className="flex items-center gap-1.5 truncate rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px]">
                      <span className={`h-3 w-1 shrink-0 rounded-full ${TONE[a.status]}`} />
                      <span className={`truncate ${a.status === "CANCELLED" ? "line-through opacity-60" : ""}`}>{time(a.startsAt)} {a.customer.name.split(" ")[0]}</span>
                    </span>
                  ))}
                  {items.length > 3 && <span className="block px-1 text-[11px] text-muted">+{items.length - 3} mais</span>}
                </span>

                {/* Celular: pontos coloridos. */}
                <span className="mt-1 flex flex-wrap gap-0.5 sm:hidden">
                  {items.slice(0, 6).map((a) => <span key={a.id} className={`size-1.5 rounded-full ${TONE[a.status]}`} />)}
                </span>
              </button>
            );
          })}
        </div>
        {loading && <Skeleton className="mt-3 h-4 w-32" />}
      </section>

      {/* Com outro popup por cima (novo agendamento, Pix), o do dia sai da tela e volta ao fechar: um Esc fecha um só. */}
      {open && !creating && !pixFor && (
        <Modal
          title={openLabel.charAt(0).toUpperCase() + openLabel.slice(1)}
          onClose={() => {
            setOpen(null);
            setShowFree(false);
            setHighlight("");
          }}
          footer={
            <div className="flex flex-col gap-2 sm:flex-row">
              <button type="button" className="btn-ghost w-full" aria-expanded={showFree} onClick={() => setShowFree((v) => !v)}>
                <Clock size={16} /> {showFree ? "Ocultar horários disponíveis" : "Ver horários disponíveis"}
              </button>
              {open >= today && (
                <button type="button" className="btn-primary w-full" onClick={() => setCreating({ date: open })}>
                  <Plus size={16} /> Novo agendamento
                </button>
              )}
            </div>
          }
        >
          {showFree && <FreePeriods date={open} />}
          {dayList.length === 0 ? (
            <p className="text-sm text-muted">Sem agendamentos neste dia{filter ? " para o filtro escolhido" : ""}.</p>
          ) : (
            <ul className="space-y-3">
              {dayList.map((a) => (
                <li key={a.id} ref={a.id === highlight ? highlightRef : undefined} className={`rounded-xl border bg-background p-3.5 ${a.id === highlight ? "border-brand ring-2 ring-brand/40" : "border-line"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{time(a.startsAt)} – {time(a.endsAt)}</p>
                      <p className="truncate text-sm">{a.customer.name}</p>
                      <p className="font-mono text-xs text-brand-soft">{formatPhone(a.customer.phone)}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <ApptBadge status={a.status} />
                      {a.payments[0] && <PayBadge status={a.payments[0].status} />}
                      {a.source === "ADMIN" && <span className="badge bg-brand/20 text-brand-soft" title="Agendado pelo painel">interno</span>}
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-muted">{a.items.map((i) => i.name).join(" + ")}</p>
                  <p className="text-sm text-muted">{brl(a.totalCents)} · sinal {brl(a.depositCents)}</p>
                  {a.notes && <p className="mt-1 text-xs italic text-muted">“{a.notes}”</p>}

                  <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                    <Link className="btn-ghost px-3 py-2" href={`/admin/whatsapp?phone=${a.customer.phone}`}><MessageSquare size={14} /> Conversar</Link>
                    {a.status === "PENDING_PAYMENT" && a.payments[0]?.pixPayload && ["PENDING", "REJECTED"].includes(a.payments[0].status) && (
                      <button className="btn-ghost px-3 py-2" onClick={() => setPixFor(a)}><QrCode size={14} /> Pix do sinal</button>
                    )}
                    {["PENDING_PAYMENT", "CONFIRMED"].includes(a.status) && (
                      <button className="btn-ghost px-3 py-2" onClick={() => setResched(a)}><CalendarClock size={14} /> Reagendar</button>
                    )}
                    {["CONFIRMED", "COMPLETED"].includes(a.status) && new Date(a.startsAt) <= new Date() && (
                      <button className="btn-ghost px-3 py-2" onClick={() => setStatus(a, "NO_SHOW")}><UserX size={14} /> Faltou</button>
                    )}
                    {["PENDING_PAYMENT", "CONFIRMED"].includes(a.status) && (
                      <button className="btn-danger px-3 py-2" onClick={() => setStatus(a, "CANCELLED")}><XCircle size={14} /> Cancelar agendamento</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}

      {creating && (
        <NewAppointmentModal
          initialDate={creating.date}
          onClose={closeCreating}
          onChanged={(a) => {
            // Recarrega já no mês do atendimento e sem filtro, para ele aparecer ao fechar o popup.
            const k = dayKey(a.startsAt);
            setCursor({ y: Number(k.slice(0, 4)), m: Number(k.slice(5, 7)) - 1 });
            setFilter("");
            setCreated(a);
            reload();
          }}
        />
      )}

      {pixFor && pixFor.payments[0]?.pixPayload && (
        <PixDepositModal
          title="Pix do sinal"
          closeLabel="Voltar à agenda"
          internal={pixFor.source === "ADMIN"}
          appointment={pixFor}
          payment={{ id: pixFor.payments[0].id, amountCents: pixFor.payments[0].amountCents, pixPayload: pixFor.payments[0].pixPayload }}
          onClose={() => setPixFor(null)}
          onChanged={reload}
        />
      )}

      {resched && (
        <Reschedule
          appt={resched}
          onClose={() => setResched(null)}
          onDone={() => {
            setResched(null);
            reload();
          }}
        />
      )}
    </>
  );
}

// Horários livres do dia na mesma grade que a cliente vê (de slotStepMinutes em slotStepMinutes a partir da abertura).
function FreePeriods({ date }: { date: string }) {
  const { data, loading, error } = useApi<{ closed: boolean; periods: { from: string; to: string; minutes: number }[]; slots: string[] }>(`/api/admin/availability?date=${date}`);
  return (
    <section className="mb-4 rounded-xl border border-brand/40 bg-brand/10 p-3.5" aria-label="Horários disponíveis">
      <h3 className="mb-2 text-sm font-semibold">Horários disponíveis</h3>
      {loading && <Skeleton className="h-4 w-40" />}
      {error && <p className="text-sm text-red-300">{error}</p>}
      {data?.closed && <p className="text-sm text-muted">Não há atendimento neste dia da semana.</p>}
      {data && !data.closed && data.slots.length === 0 && <p className="text-sm text-muted">Nenhum horário livre: dia cheio ou já passou.</p>}
      {data && data.slots.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label="Horários livres">
          {data.slots.map((s) => (
            <li key={s} className="rounded-lg border border-line bg-surface py-2 text-center text-sm font-semibold">{time(s)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Popup de reagendamento: mesmos serviços e valores; só muda data e hora. As vagas consideram a duração
// dos serviços contratados e ignoram a antecedência mínima em dias (quem remarca é o estúdio).
function Reschedule({ appt, onClose, onDone }: { appt: Appt; onClose: () => void; onDone: () => void }) {
  const [days, setDays] = useState<Day[] | null>(null);
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<string[] | null>(null);
  const [slotsMsg, setSlotsMsg] = useState<string | null>(null);
  const [slot, setSlot] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const base = `/api/admin/appointments/${appt.id}/reschedule`;

  useEffect(() => {
    api<{ days: Day[] }>(base).then((r) => setDays(r.days)).catch((e) => setError(e.message));
  }, [base]);

  useEffect(() => {
    setSlot("");
    setSlots(null);
    setSlotsMsg(null);
    if (!date) return;
    api<{ slots: string[]; message: string | null }>(`${base}?date=${date}`)
      .then((r) => {
        setSlots(r.slots);
        setSlotsMsg(r.message);
      })
      .catch((e) => setError(e.message));
  }, [date, base]);

  async function confirmIt() {
    if (!slot) return;
    setBusy(true);
    setError("");
    try {
      const r = await api<{ sent: boolean }>(base, { method: "POST", body: { startsAt: slot } });
      toast(r.sent ? "Horário remarcado. A cliente foi avisada no WhatsApp." : "Horário remarcado. Não foi possível avisar pelo WhatsApp: confira a conexão.", r.sent);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
      setBusy(false);
    }
  }

  return (
    <Modal title={`Reagendar: ${appt.customer.name}`} onClose={onClose} top>
      <p className="text-sm text-muted">{appt.items.map((i) => i.name).join(" + ")} · atual: {fmtDateTime(appt.startsAt)}</p>
      <p className="mb-4 text-xs text-muted">Serviços, valores e o sinal pago continuam os mesmos. Só a data e a hora mudam.</p>
      {days === null && !error && <Skeleton className="h-64 w-full" />}
      {days && <MonthCalendar days={days} value={date} onChange={setDate} />}
      {date && (
        <div className="mt-4">
          <p className="label">Horário</p>
          {slots === null && <p className="text-sm text-muted">Buscando horários…</p>}
          {slots && slots.length === 0 && <p className="text-sm text-muted">{slotsMsg ?? "Sem horários livres neste dia."}</p>}
          {slots && slots.length > 0 && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" role="group" aria-label="Horários">
              {slots.map((s) => (
                <button key={s} type="button" aria-pressed={slot === s} onClick={() => setSlot(s)} className={slot === s ? "btn-primary" : "btn-ghost"}>{time(s)}</button>
              ))}
            </div>
          )}
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onClose}>Voltar</button>
        <button type="button" className="btn-primary" disabled={!slot || busy} onClick={confirmIt}>{busy ? "Remarcando…" : "Confirmar novo horário"}</button>
      </div>
    </Modal>
  );
}
