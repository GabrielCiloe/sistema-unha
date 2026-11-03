"use client";

import { Calendar, Clock, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { BrandHeader } from "@/components/brand-header";
import { api } from "@/lib/client";
import { brl, maskPhone } from "@/lib/templates";
import { InlineSkeleton, PublicSkeleton } from "@/components/skeleton";
import { MonthCalendar, type Day } from "@/components/month-calendar";

type Info = {
  business: { name: string; address: string; depositPercent: number; workDays: number[]; tagline: string; logoUrl: string | null; coverDesktopUrl: string | null; coverMobileUrl: string | null };
  services: { id: string; name: string; description: string; durationMin: number; priceCents: number; missingNailPriceCents: number }[];
};


// 120 -> "2h", 90 -> "1h30", 45 -> "45 min"
const fmtDuration = (m: number) => {
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h === 0 ? `${r} min` : r === 0 ? `${h}h` : `${h}h${String(r).padStart(2, "0")}`;
};
// 120 -> "2 horas", 90 -> "1h30", 45 -> "45 minutos"
const fmtEstimate = (m: number) => {
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} minutos`;
  if (r === 0) return h === 1 ? "1 hora" : `${h} horas`;
  return `${h}h${String(r).padStart(2, "0")}`;
};

const DAYS_AHEAD = 60; // quantos dias de disponibilidade a API devolve (limite dela)

const hhmm = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export default function BookingPage() {
  const [info, setInfo] = useState<Info | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<string[] | null>(null);
  const [slotsMsg, setSlotsMsg] = useState<string | null>(null);
  const [avail, setAvail] = useState<Day[] | null>(null);
  const [slot, setSlot] = useState("");
  const [phone, setPhone] = useState("");
  // Manutencao: "tem unha faltando?" (sim/nao) e quantas, por servico.
  const [missing, setMissing] = useState<Record<string, number>>({});
  const [hasMissing, setHasMissing] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Cada escolha leva a cliente ao próximo passo: serviço → calendário → horários → dados/pagamento.
  const calRef = useRef<HTMLElement>(null);
  const slotsRef = useRef<HTMLElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const goTo = (el: HTMLElement | null) => {
    if (!el) return;
    setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };

  useEffect(() => {
    api<Info>("/api/public/info").then(setInfo).catch((e) => setError(e.message));
  }, []);

  const chosen = useMemo(() => info?.services.filter((s) => selected.includes(s.id)) ?? [], [info, selected]);
  const missingOf = (id: string, unit: number) => (unit > 0 && hasMissing[id] ? (missing[id] ?? 1) : 0);
  const extras = chosen.reduce((s, x) => s + missingOf(x.id, x.missingNailPriceCents) * x.missingNailPriceCents, 0);
  const total = chosen.reduce((s, x) => s + x.priceCents, 0) + extras;
  const maintenance = chosen.filter((s) => s.missingNailPriceCents > 0);
  const minutes = chosen.reduce((s, x) => s + x.durationMin, 0);
  const deposit = info ? Math.max(1, Math.round((total * info.business.depositPercent) / 100)) : 0;

  // Dias com disponibilidade real para os serviços escolhidos (os sem vaga ficam apagados).
  useEffect(() => {
    setAvail(null);
    setDate("");
    if (selected.length === 0) return;
    api<{ days: Day[] }>(`/api/public/availability?serviceIds=${selected.join(",")}&days=${DAYS_AHEAD}`)
      .then((r) => setAvail(r.days))
      .catch((e) => setError(e.message));
  }, [selected]);

  useEffect(() => {
    if (avail !== null && selected.length > 0) goTo(calRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avail]);
  useEffect(() => {
    if (date) goTo(slotsRef.current);
  }, [date]);
  useEffect(() => {
    if (slot) goTo(formRef.current);
  }, [slot]);

  const shownDays = (avail ?? []).filter((d) => d.reason !== "closed");
  const allBlocked = avail !== null && shownDays.length > 0 && shownDays.every((d) => !d.available);
  const blockedMsg = allBlocked ? (shownDays.find((d) => d.reason === "too_long") ?? shownDays[0]).message : null;

  useEffect(() => {
    setSlot("");
    setSlots(null);
    setSlotsMsg(null);
    if (!date || selected.length === 0) return;
    api<{ slots: string[]; message: string | null }>(`/api/public/slots?date=${date}&serviceIds=${selected.join(",")}`)
      .then((r) => {
        setSlots(r.slots);
        setSlotsMsg(r.message);
      })
      .catch((e) => setError(e.message));
  }, [date, selected]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const r = await api<{ token: string }>("/api/public/bookings", {
        method: "POST",
        body: {
          serviceIds: selected,
          startsAt: slot,
          name: f.get("name"),
          phone: f.get("phone"),
          missingNails: Object.fromEntries(maintenance.map((s) => [s.id, missingOf(s.id, s.missingNailPriceCents)])),
        },
      });
      window.location.href = `/reserva/${r.token}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
      setBusy(false);
    }
  }

  if (!info) return error ? <p role="alert" className="p-8 text-center text-red-700">{error}</p> : <PublicSkeleton />;

  return (
    <>
      <BrandHeader name={info.business.name} logoUrl={info.business.logoUrl} tagline={info.business.tagline} cover={{ desktop: info.business.coverDesktopUrl, mobile: info.business.coverMobileUrl }} />

      <main className="mx-auto max-w-[390px] space-y-[15px] px-5 pb-20">
        <section id="servicos" className="pcard">
          <h2 className="ptitle">1.Escolha o serviço</h2>
          {info.services.length === 0 ? (
            <p className="text-sm text-muted">Agenda ainda não disponível.</p>
          ) : (
            <ul className="space-y-[10px]">
              {info.services.map((s) => {
                const on = selected.includes(s.id);
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => setSelected(on ? selected.filter((x) => x !== s.id) : [...selected, s.id])}
                      className={`flex w-full items-center justify-between gap-3 rounded-[10px] p-4 text-left transition ${on ? "border-2 border-brand bg-brand/10" : "border border-brand/10 bg-brand/5 hover:border-brand/40"}`}
                    >
                      <span className="min-w-0 leading-[1.4]">
                        <span className="block text-[14px] font-bold text-ink">{s.name}</span>
                        <span className="block text-[12px] text-ink/35">Duração: {fmtDuration(s.durationMin)}</span>
                      </span>
                      <span className="shrink-0 text-[14px] font-bold text-ink">{brl(s.priceCents)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {maintenance.map((s) => {
          const on = Boolean(hasMissing[s.id]);
          const n = missing[s.id] ?? 1;
          return (
            <section key={s.id} className="pcard">
              <h2 className="ptitle">Manutenção: Unha adicionada</h2>
              <p className="mb-3 text-[14px] font-medium text-ink">Tem unha faltando?</p>
              <div className="grid grid-cols-2 gap-x-5" role="group" aria-label={`Unha faltando em ${s.name}`}>
                {[false, true].map((v) => (
                  <button
                    key={String(v)}
                    type="button"
                    aria-pressed={on === v}
                    onClick={() => setHasMissing({ ...hasMissing, [s.id]: v })}
                    className={`h-[41px] rounded-[10px] text-[16px] font-semibold leading-[1.4] transition ${on === v ? "bg-brand text-white" : "border border-accent/10 bg-accent/5 text-ink hover:border-accent/40"}`}
                  >
                    {v ? "Sim" : "Não"}
                  </button>
                ))}
              </div>
              {on && (
                <div className="mt-4 flex items-center justify-between gap-3 rounded-[10px] border border-brand bg-brand/10 p-4 leading-[1.4]">
                  <span>
                    <span className="block text-[14px] font-bold text-ink">Quantas unhas?</span>
                    <span className="block text-[12px] text-ink/35">{brl(s.missingNailPriceCents)} por unha · + {brl(n * s.missingNailPriceCents)}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <button type="button" aria-label="Menos uma unha" disabled={n <= 1} onClick={() => setMissing({ ...missing, [s.id]: n - 1 })} className="flex size-9 items-center justify-center rounded-full bg-surface text-accent disabled:opacity-30"><Minus size={16} /></button>
                    <span className="w-6 text-center text-[16px] font-bold text-ink" aria-live="polite">{n}</span>
                    <button type="button" aria-label="Mais uma unha" disabled={n >= 10} onClick={() => setMissing({ ...missing, [s.id]: n + 1 })} className="flex size-9 items-center justify-center rounded-full bg-brand text-white disabled:opacity-30"><Plus size={16} /></button>
                  </span>
                </div>
              )}
            </section>
          );
        })}

        {selected.length > 0 && (
          <section ref={calRef} className="pcard scroll-mt-4">
            <h2 className="ptitle"><Calendar size={18} className="text-accent" aria-hidden /> Selecione a data</h2>
            {avail === null && <InlineSkeleton />}
            {blockedMsg && (
              <p role="alert" className="mb-3 rounded-[10px] border border-amber-500/40 bg-amber-50 p-3 text-sm text-amber-800">{blockedMsg}</p>
            )}
            {avail !== null && <MonthCalendar days={avail} value={date} onChange={setDate} />}
          </section>
        )}

        {date && (
          <section ref={slotsRef} className="pcard scroll-mt-4">
            <h2 className="ptitle"><Clock size={19} className="text-accent" aria-hidden /> Selecione o horário</h2>
            {slots === null && <p className="text-sm text-muted">Buscando horários…</p>}
            {slots && slots.length === 0 && <p role="status" className="text-sm text-muted">{slotsMsg ?? "Sem horários livres neste dia. Tente outra data."}</p>}
            {slots && slots.length > 0 && (
              <div className="grid grid-cols-2 gap-x-5 gap-y-[10px]" role="group" aria-label="Horários">
                {slots.map((s) => {
                  const on = slot === s;
                  return (
                    <button key={s} type="button" aria-pressed={on} onClick={() => setSlot(s)} className={`h-[41px] rounded-[10px] text-center text-[16px] font-semibold leading-[1.4] transition ${on ? "bg-brand text-white" : "border border-accent/10 bg-accent/5 text-ink hover:border-accent/40"}`}>
                      {hhmm(s)}
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {slot && (
          <form ref={formRef} onSubmit={submit} className="scroll-mt-4 space-y-[40px]">
            <section className="pcard space-y-[15px]">
              <h2 className="ptitle !mb-[26px]">Seus dados</h2>
              <div>
                <label className="plabel" htmlFor="name">Nome<span className="text-[14px]">*</span></label>
                <input id="name" name="name" required minLength={2} autoComplete="name" placeholder="Digite aqui" className="pinput" />
              </div>
              <div>
                <label className="plabel" htmlFor="phone">WhatsApp(com DDD)<span className="text-[14px]">*</span></label>
                <input id="phone" name="phone" required type="tel" inputMode="tel" autoComplete="tel" placeholder="Digite aqui" className="pinput" value={phone} onChange={(e) => setPhone(maskPhone(e.target.value))} />
              </div>
              {/* Resumo da reserva: cada serviço com o valor, unhas faltando, total e sinal (% e valor). */}
              <div className="!mt-5 rounded-[10px] border border-brand bg-brand/10 p-4 leading-[1.4]" aria-label="Resumo da reserva">
                <p className="mb-2 text-[14px] font-bold text-ink">Resumo</p>
                <ul className="space-y-1.5">
                  {chosen.map((s) => {
                    const n = missingOf(s.id, s.missingNailPriceCents);
                    return (
                      <li key={s.id}>
                        <div className="flex justify-between gap-3 text-[13px] text-ink">
                          <span>{s.name} <span className="text-ink/35">· {fmtDuration(s.durationMin)}</span></span>
                          <span className="shrink-0 font-semibold">{brl(s.priceCents)}</span>
                        </div>
                        {n > 0 && (
                          <div className="flex justify-between gap-3 text-[12px] text-ink/60">
                            <span>{n} {n === 1 ? "unha faltando" : "unhas faltando"} × {brl(s.missingNailPriceCents)}</span>
                            <span className="shrink-0">+ {brl(n * s.missingNailPriceCents)}</span>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-3 border-t border-brand/40 pt-3">
                  <div className="flex justify-between gap-3 text-[14px] font-bold text-ink">
                    <span>Total <span className="text-[12px] font-normal text-ink/35">· tempo estimado {fmtEstimate(minutes)}</span></span>
                    <span className="shrink-0">{brl(total)}</span>
                  </div>
                  <div className="mt-1 flex justify-between gap-3 text-[14px] font-bold text-accent">
                    <span>Sinal para reservar ({info.business.depositPercent}%)</span>
                    <span className="shrink-0">{brl(deposit)}</span>
                  </div>
                  <p className="mt-1 text-[12px] text-ink/35">O sinal é pago agora por Pix; o restante ({brl(total - deposit)}) no dia do atendimento.</p>
                </div>
              </div>
            </section>
            {error && <p role="alert" className="!mt-4 text-sm text-red-700">{error}</p>}
            <button disabled={busy} className="flex h-[50px] w-full items-center justify-center rounded-[8px] bg-accent text-[16px] font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">
              {busy ? "Reservando…" : "Reservar e pagar o sinal"}
            </button>
          </form>
        )}
        {!slot && error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </main>
    </>
  );
}
