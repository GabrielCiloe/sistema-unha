"use client";

import { Calendar, Clock, Minus, Plus, UserPlus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { PixDepositModal } from "@/components/admin/pix-deposit-modal";
import { Modal } from "@/components/modal";
import { MonthCalendar, type Day } from "@/components/month-calendar";
import { Skeleton } from "@/components/skeleton";
import { api, ApiError } from "@/lib/client";
import { brl, fmtDuration, fmtEstimate, formatPhone, maskPhone } from "@/lib/templates";

type Info = {
  business: { depositPercent: number };
  services: { id: string; name: string; durationMin: number; priceCents: number; missingNailPriceCents: number }[];
};
type Found = { phone: string; name: string };
export type CreatedAppointment = { id: string; startsAt: string; customer: { name: string; phone: string } };
type Saved = { appointment: CreatedAppointment; payment: { id: string; amountCents: number; pixPayload: string }; whatsappSent: boolean };

const DAYS_AHEAD = 60;
const TZ = "America/Sao_Paulo";
const hhmm = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const dayLabel = (date: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "long", day: "2-digit", month: "2-digit" }).format(new Date(`${date}T12:00:00Z`));
const digitsOf = (v: string) => v.replace(/\D/g, "");
// O que foi digitado parece telefone (só dígitos e máscara)? Mesma regra do autocomplete no servidor.
const phoneLike = (v: string) => /\d/.test(v) && /^[\d\s()+\-.]+$/.test(v);

// Agenda > "Novo agendamento": o mesmo fluxo da página da cliente (serviço → data → horário → dados → sinal),
// começando pela cliente (busca por telefone ou nome) e terminando com o Pix copia e cola para a dona repassar.
export function NewAppointmentModal({
  initialDate,
  onClose,
  onChanged,
}: {
  initialDate?: string;
  onClose: () => void;
  // Chamado quando o agendamento é criado e quando o sinal é marcado como recebido (a agenda recarrega).
  onChanged: (a: CreatedAppointment) => void;
}) {
  const [info, setInfo] = useState<Info | null>(null);
  // 1) Cliente
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);
  const [searchError, setSearchError] = useState(false);
  const [customer, setCustomer] = useState<Found | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  // 2) Serviços
  const [selected, setSelected] = useState<string[]>([]);
  const [missing, setMissing] = useState<Record<string, number>>({});
  const [hasMissing, setHasMissing] = useState<Record<string, boolean>>({});
  // 3) Data e 4) Horário
  const [avail, setAvail] = useState<Day[] | null>(null);
  const [date, setDate] = useState("");
  const wanted = useRef(initialDate ?? ""); // data a manter/pré-selecionar quando a disponibilidade (re)carrega
  const [slots, setSlots] = useState<string[] | null>(null);
  const [slotsMsg, setSlotsMsg] = useState<string | null>(null);
  const [slot, setSlot] = useState("");
  const [manual, setManual] = useState(false);
  const [manualTime, setManualTime] = useState("");
  const [refresh, setRefresh] = useState(0);
  // 5) Resumo e 6) Pix
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Saved | null>(null);

  const calRef = useRef<HTMLElement>(null);
  const slotsRef = useRef<HTMLElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const goTo = (el: HTMLElement | null) => {
    if (!el) return;
    setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };

  // Mesma lista de serviços ativos e mesmo percentual de sinal que a cliente vê.
  useEffect(() => {
    api<Info>("/api/public/info").then(setInfo).catch((e) => setError(e.message));
  }, []);

  // Autocomplete: 2+ dígitos (prefixo do telefone) ou 2+ letras (trecho do nome), com espera de digitação.
  const term = q.trim();
  const searchable = !customer && !isNew && (phoneLike(term) ? digitsOf(term).length >= 2 : term.length >= 2);
  useEffect(() => {
    // Termo novo: a lista antiga some e fica "Buscando…" até a resposta deste termo chegar.
    setFound(null);
    setSearchError(false);
    if (!searchable) return;
    let cancelled = false;
    const t = setTimeout(() => {
      api<{ customers: Found[] }>(`/api/admin/customers?autocomplete=1&q=${encodeURIComponent(term)}`)
        .then((r) => !cancelled && setFound(r.customers))
        .catch(() => !cancelled && setSearchError(true));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [term, searchable]);

  const startNew = () => {
    setIsNew(true);
    if (phoneLike(term)) setPhone(maskPhone(term));
    else setName(term);
  };
  const clearCustomer = () => {
    setCustomer(null);
    setIsNew(false);
    setName("");
    setPhone("");
    setQ("");
  };

  const who = customer ?? (isNew ? { name: name.trim(), phone } : null);
  const whoOk = Boolean(who && who.name.length >= 2 && digitsOf(who.phone).length >= 10);

  const chosen = useMemo(() => info?.services.filter((s) => selected.includes(s.id)) ?? [], [info, selected]);
  const missingOf = (id: string, unit: number) => (unit > 0 && hasMissing[id] ? (missing[id] ?? 1) : 0);
  const extras = chosen.reduce((s, x) => s + missingOf(x.id, x.missingNailPriceCents) * x.missingNailPriceCents, 0);
  const total = chosen.reduce((s, x) => s + x.priceCents, 0) + extras;
  const maintenance = chosen.filter((s) => s.missingNailPriceCents > 0);
  const minutes = chosen.reduce((s, x) => s + x.durationMin, 0);
  const deposit = info ? Math.max(1, Math.round((total * info.business.depositPercent) / 100)) : 0;

  // Disponibilidade a partir de hoje (sem antecedência mínima). A data já escolhida continua se ainda servir.
  const key = selected.join(",");
  useEffect(() => {
    setAvail(null);
    setDate("");
    if (!key) return;
    let cancelled = false;
    api<{ days: Day[] }>(`/api/admin/availability?serviceIds=${key}&days=${DAYS_AHEAD}`)
      .then((r) => !cancelled && setAvail(r.days))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [key]);

  // Com "horário fora da grade", só o dia fechado continua bloqueado (dia cheio na grade pode ter um encaixe).
  const days = useMemo(() => (manual ? (avail ?? []).map((d) => (d.reason === "closed" ? d : { ...d, available: true })) : (avail ?? [])), [avail, manual]);
  useEffect(() => {
    if (avail === null) return;
    const d = days.find((x) => x.date === wanted.current);
    setDate(d?.available ? d.date : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);
  const pickDate = (d: string) => {
    wanted.current = d;
    setError("");
    setDate(d);
  };
  // Mês em que o calendário abre: o da data desejada (vinda da agenda ou já escolhida), se estiver na janela oferecida.
  const wantedMonth = wanted.current.slice(0, 7);
  const initialMonth = avail?.length && wantedMonth >= avail[0].date.slice(0, 7) && wantedMonth <= avail[avail.length - 1].date.slice(0, 7) ? wantedMonth : undefined;

  const shownDays = (avail ?? []).filter((d) => d.reason !== "closed");
  const allBlocked = !manual && avail !== null && shownDays.length > 0 && shownDays.every((d) => !d.available);
  const blockedMsg = allBlocked ? (shownDays.find((d) => d.reason === "too_long") ?? shownDays[0]).message : null;

  useEffect(() => {
    setSlot("");
    setSlots(null);
    setSlotsMsg(null);
    if (!date || !key) return;
    let cancelled = false;
    api<{ slots: string[]; message: string | null }>(`/api/admin/slots?date=${date}&serviceIds=${key}`)
      .then((r) => {
        if (cancelled) return;
        setSlots(r.slots);
        setSlotsMsg(r.message);
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [date, key, refresh]);

  const timeOk = manual ? /^([01]\d|2[0-3]):[0-5]\d$/.test(manualTime) : Boolean(slot);
  const whenOk = Boolean(date) && timeOk;
  const ready = whoOk && chosen.length > 0 && whenOk;

  useEffect(() => {
    if (avail !== null && key && !date) goTo(calRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avail]);
  useEffect(() => {
    if (date) goTo(slotsRef.current);
  }, [date]);
  useEffect(() => {
    if (slot) goTo(summaryRef.current);
  }, [slot]);

  async function save() {
    if (!ready || !who) return;
    setBusy(true);
    setError("");
    try {
      const r = await api<Saved>("/api/admin/appointments", {
        method: "POST",
        body: {
          serviceIds: selected,
          missingNails: Object.fromEntries(maintenance.map((s) => [s.id, missingOf(s.id, s.missingNailPriceCents)])),
          // Com horário manual, o servidor usa só o DIA de startsAt (meio-dia local) e a hora de manualTime.
          startsAt: manual ? new Date(`${date}T12:00:00-03:00`).toISOString() : slot,
          ...(manual ? { manualTime } : {}),
          name: who.name,
          phone: who.phone,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          allowToday: true,
        },
      });
      setSaved(r);
      onChanged(r.appointment);
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        if (e.status === 409) setRefresh((n) => n + 1); // horário ocupado: busca a grade de novo (o horário escolhido é desmarcado)
      } else {
        // Sem resposta do servidor: o agendamento pode ou não ter sido gravado.
        setError("Sem resposta do servidor. Confira na agenda se o agendamento foi criado antes de tentar de novo.");
      }
    } finally {
      setBusy(false);
    }
  }

  // 6) Depois de salvar: Pix copia e cola para a dona repassar à cliente (Esc e clique no fundo não fecham).
  if (saved) {
    return (
      <PixDepositModal
        title="Agendamento criado"
        closeLabel="Concluir"
        sticky
        internal
        appointment={saved.appointment}
        payment={saved.payment}
        onClose={onClose}
        onChanged={() => onChanged(saved.appointment)}
      />
    );
  }

  // Esc ou clique no fundo com algo preenchido: confirma antes de descartar.
  const dirty = Boolean(q.trim() || customer || isNew || selected.length || notes.trim());
  const dismiss = () => {
    if (!dirty || confirm("Descartar este agendamento? O que foi preenchido será perdido.")) onClose();
  };

  const pick = "rounded-xl text-sm font-semibold transition";
  return (
    <Modal
      title="Novo agendamento"
      onClose={onClose}
      onDismiss={dismiss}
      top
      footer={
        <>
          {error && <p role="alert" className="mb-2 text-sm text-red-300">{error}</p>}
          <button type="button" className="btn-primary w-full" disabled={!ready || busy} onClick={save}>{busy ? "Salvando…" : "Salvar agendamento"}</button>
        </>
      }
    >
      <div className="space-y-6">
        {/* 1) Cliente */}
        <section aria-label="Cliente">
          <h3 className="mb-2 text-sm font-semibold">1. Cliente</h3>
          {customer ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-brand bg-brand/15 p-3.5">
              <div className="min-w-0">
                <p className="truncate font-semibold">{customer.name}</p>
                <p className="font-mono text-xs text-brand-soft">{formatPhone(customer.phone)}</p>
              </div>
              <button type="button" className="btn-ghost shrink-0 px-3 py-2" onClick={clearCustomer}><X size={14} /> Trocar</button>
            </div>
          ) : isNew ? (
            <div className="space-y-3">
              <div>
                <label className="label" htmlFor="na-name">Nome</label>
                <input id="na-name" className="input" required minLength={2} maxLength={80} autoComplete="off" placeholder="Nome da cliente" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="na-phone">WhatsApp (com DDD)</label>
                <input id="na-phone" className="input" required type="tel" inputMode="tel" autoComplete="off" placeholder="(19) 99999-0000" value={phone} onChange={(e) => setPhone(maskPhone(e.target.value))} />
              </div>
              <button type="button" className="text-xs font-medium text-brand-soft underline" onClick={clearCustomer}>Buscar cliente já cadastrada</button>
            </div>
          ) : (
            <>
              <label className="label" htmlFor="na-q">WhatsApp ou nome da cliente</label>
              <input
                id="na-q"
                className="input"
                data-autofocus
                autoComplete="off"
                inputMode="search"
                placeholder="Digite o número ou o nome"
                value={q}
                onChange={(e) => setQ(/^[\d(+]/.test(e.target.value.trimStart()) ? maskPhone(e.target.value) : e.target.value)}
              />
              <div className="mt-2 space-y-2">
                {searchable && !found && !searchError && <p role="status" className="text-sm text-muted">Buscando…</p>}
                {searchError && <p role="alert" className="text-sm text-red-300">Não foi possível buscar. Tente de novo.</p>}
                {found && found.length > 0 && (
                  <ul className="overflow-hidden rounded-xl border border-line" aria-label="Clientes encontradas">
                    {found.map((c) => (
                      <li key={c.phone} className="border-b border-line last:border-0">
                        <button type="button" className="flex w-full items-center justify-between gap-3 bg-background px-3.5 py-2.5 text-left transition hover:bg-surface-2" onClick={() => setCustomer({ name: c.name, phone: c.phone })}>
                          <span className="min-w-0 truncate text-sm font-medium">{c.name}</span>
                          <span className="shrink-0 font-mono text-xs text-brand-soft">{formatPhone(c.phone)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {found && found.length === 0 && <p role="status" className="text-sm text-muted">Nenhuma cliente encontrada.</p>}
                <button type="button" className="btn-ghost w-full" onClick={startNew}><UserPlus size={16} /> Cadastrar cliente nova</button>
              </div>
            </>
          )}
        </section>

        {/* 2) Serviços */}
        <section aria-label="Serviços">
          <h3 className="mb-2 text-sm font-semibold">2. Serviço</h3>
          {!info ? (
            <Skeleton className="h-24 w-full" />
          ) : info.services.length === 0 ? (
            <p className="text-sm text-muted">Nenhum serviço ativo. Cadastre em Serviços.</p>
          ) : (
            <ul className="space-y-2">
              {info.services.map((s) => {
                const on = selected.includes(s.id);
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => setSelected(on ? selected.filter((x) => x !== s.id) : [...selected, s.id])}
                      className={`flex w-full items-center justify-between gap-3 rounded-xl border p-3.5 text-left transition ${on ? "border-brand bg-brand/15" : "border-line bg-background hover:border-brand-soft"}`}
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{s.name}</span>
                        <span className="block text-xs text-muted">Duração: {fmtDuration(s.durationMin)}</span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold">{brl(s.priceCents)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {maintenance.map((s) => {
            const on = Boolean(hasMissing[s.id]);
            const n = missing[s.id] ?? 1;
            return (
              <div key={s.id} className="mt-3 rounded-xl border border-line bg-background p-3.5">
                <p className="text-xs text-muted">{s.name}</p>
                <p className="mb-2 text-sm font-medium">Tem unha faltando?</p>
                <div className="grid grid-cols-2 gap-2" role="group" aria-label={`Unha faltando em ${s.name}`}>
                  {[false, true].map((v) => (
                    <button key={String(v)} type="button" aria-pressed={on === v} onClick={() => setHasMissing({ ...hasMissing, [s.id]: v })} className={on === v ? "btn-primary" : "btn-ghost"}>
                      {v ? "Sim" : "Não"}
                    </button>
                  ))}
                </div>
                {on && (
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-brand bg-brand/15 p-3.5">
                    <span>
                      <span className="block text-sm font-semibold">Quantas unhas?</span>
                      <span className="block text-xs text-muted">{brl(s.missingNailPriceCents)} por unha · + {brl(n * s.missingNailPriceCents)}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <button type="button" aria-label="Menos uma unha" disabled={n <= 1} onClick={() => setMissing({ ...missing, [s.id]: n - 1 })} className="flex size-9 items-center justify-center rounded-full border border-line bg-surface-2 disabled:opacity-30"><Minus size={16} /></button>
                      <span className="w-6 text-center font-semibold" aria-live="polite">{n}</span>
                      <button type="button" aria-label="Mais uma unha" disabled={n >= 10} onClick={() => setMissing({ ...missing, [s.id]: n + 1 })} className="flex size-9 items-center justify-center rounded-full bg-brand text-on-brand disabled:opacity-30"><Plus size={16} /></button>
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </section>

        {/* 3) Data */}
        {selected.length === 0 && initialDate && (
          <p className="text-sm text-muted">Data escolhida na agenda: <span className="text-ink">{dayLabel(initialDate)}</span>. Selecione o serviço para ver os horários.</p>
        )}
        {selected.length > 0 && (
          <section ref={calRef} aria-label="Data" className="scroll-mt-2">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Calendar size={16} className="text-brand-soft" aria-hidden /> 3. Data</h3>
            {avail === null && <Skeleton className="h-64 w-full" />}
            {blockedMsg && <p role="alert" className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300">{blockedMsg}</p>}
            {avail !== null && <MonthCalendar days={days} value={date} onChange={pickDate} initialMonth={initialMonth} />}
            {avail !== null && initialDate && !date && wanted.current === initialDate && (
              <p role="status" className="mt-3 text-sm text-muted">
                {avail.find((d) => d.date === initialDate)?.message ?? `Sem horários livres em ${dayLabel(initialDate)}.`} Escolha outra data{manual ? "" : " ou use um horário fora da grade"}.
              </p>
            )}
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-[var(--color-brand)]" checked={manual} onChange={(e) => { setError(""); setManual(e.target.checked); }} />
              Horário fora da grade (encaixe)
            </label>
          </section>
        )}

        {/* 4) Horário */}
        {date && (
          <section ref={slotsRef} aria-label="Horário" className="scroll-mt-2">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold first-letter:uppercase"><Clock size={16} className="text-brand-soft" aria-hidden /> 4. Horário · {dayLabel(date)}</h3>
            {manual ? (
              <div>
                <label className="label" htmlFor="na-time">Horário fora da grade (HH:MM)</label>
                <input id="na-time" type="time" className="input max-w-40" value={manualTime} onChange={(e) => { setError(""); setManualTime(e.target.value); }} />
                <p className="mt-1.5 text-xs text-muted">Pode ficar fora do expediente, mas não em cima de outro atendimento nem no passado.</p>
              </div>
            ) : (
              <>
                {slots === null && <p className="text-sm text-muted">Buscando horários…</p>}
                {slots && slots.length === 0 && <p role="status" className="text-sm text-muted">{slotsMsg ?? "Sem horários livres neste dia. Tente outra data ou use um horário fora da grade."}</p>}
                {slots && slots.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" role="group" aria-label="Horários">
                    {slots.map((s) => (
                      <button key={s} type="button" aria-pressed={slot === s} onClick={() => { setError(""); setSlot(s); }} className={`${pick} ${slot === s ? "btn-primary" : "btn-ghost"}`}>{hhmm(s)}</button>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {/* 5) Resumo: igual ao da cliente (itens, unhas faltando, total, tempo estimado, sinal e restante). */}
        {whenOk && info && (
          <section ref={summaryRef} aria-label="Resumo" className="scroll-mt-2">
            <h3 className="mb-2 text-sm font-semibold">5. Resumo</h3>
            <div className="rounded-xl border border-brand bg-brand/15 p-3.5" aria-label="Resumo da reserva">
              <p className="mb-2 text-sm">
                {who?.name ? <span className="font-semibold">{who.name}</span> : <span className="text-amber-300">Escolha a cliente</span>}
                <span className="text-muted first-letter:uppercase"> · {dayLabel(date)} às {manual ? manualTime : hhmm(slot)}</span>
              </p>
              <ul className="space-y-1.5">
                {chosen.map((s) => {
                  const n = missingOf(s.id, s.missingNailPriceCents);
                  return (
                    <li key={s.id}>
                      <div className="flex justify-between gap-3 text-sm">
                        <span>{s.name} <span className="text-muted">· {fmtDuration(s.durationMin)}</span></span>
                        <span className="shrink-0 font-semibold">{brl(s.priceCents)}</span>
                      </div>
                      {n > 0 && (
                        <div className="flex justify-between gap-3 text-xs text-muted">
                          <span>{n} {n === 1 ? "unha faltando" : "unhas faltando"} × {brl(s.missingNailPriceCents)}</span>
                          <span className="shrink-0">+ {brl(n * s.missingNailPriceCents)}</span>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className="mt-3 border-t border-brand/40 pt-3">
                <div className="flex justify-between gap-3 text-sm font-bold">
                  <span>Total <span className="text-xs font-normal text-muted">· tempo estimado {fmtEstimate(minutes)}</span></span>
                  <span className="shrink-0">{brl(total)}</span>
                </div>
                <div className="mt-1 flex justify-between gap-3 text-sm font-bold text-brand-soft">
                  <span>Sinal para reservar ({info.business.depositPercent}%)</span>
                  <span className="shrink-0">{brl(deposit)}</span>
                </div>
                <p className="mt-1 text-xs text-muted">O sinal é pago por Pix; o restante ({brl(total - deposit)}) no dia do atendimento.</p>
              </div>
            </div>
            <label className="label mt-3" htmlFor="na-notes">Observações (opcional)</label>
            <input id="na-notes" className="input" maxLength={300} autoComplete="off" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </section>
        )}
      </div>
    </Modal>
  );
}
