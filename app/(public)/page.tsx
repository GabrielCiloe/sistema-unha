"use client";

import { Check, Clock, MapPin, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client";
import { brl, maskPhone } from "@/lib/templates";
import { InlineSkeleton, PublicSkeleton } from "@/components/skeleton";

type Info = {
  business: { name: string; address: string; depositPercent: number; workDays: number[]; tagline: string; logoUrl: string | null; coverDesktopUrl: string | null; coverMobileUrl: string | null };
  services: { id: string; name: string; description: string; durationMin: number; priceCents: number }[];
};

type Day = { date: string; available: boolean; reason: string | null; message: string | null };

const fmtDuration = (m: number) => {
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h === 0 ? `${r} min` : r === 0 ? `${h}h` : `${h}h${String(r).padStart(2, "0")}`;
};

const todayStr = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date());
const addDays = (s: string, n: number) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const weekday = (s: string) => new Date(`${s}T12:00:00Z`).getUTCDay();
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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Info>("/api/public/info").then(setInfo).catch((e) => setError(e.message));
  }, []);

  const chosen = useMemo(() => info?.services.filter((s) => selected.includes(s.id)) ?? [], [info, selected]);
  const total = chosen.reduce((s, x) => s + x.priceCents, 0);
  const minutes = chosen.reduce((s, x) => s + x.durationMin, 0);
  const deposit = info ? Math.max(1, Math.round((total * info.business.depositPercent) / 100)) : 0;
  // Dias com disponibilidade real para os serviços escolhidos (some o que não cabe ou está lotado).
  useEffect(() => {
    setAvail(null);
    setDate("");
    if (selected.length === 0) return;
    api<{ days: Day[] }>(`/api/public/availability?serviceIds=${selected.join(",")}&days=21`)
      .then((r) => setAvail(r.days))
      .catch((e) => setError(e.message));
  }, [selected]);

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
        body: { serviceIds: selected, startsAt: slot, name: f.get("name"), phone: f.get("phone"), notes: f.get("notes") || undefined },
      });
      window.location.href = `/reserva/${r.token}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
      setBusy(false);
    }
  }

  if (!info) return error ? <p role="alert" className="p-8 text-center text-red-300">{error}</p> : <PublicSkeleton />;

  return (
    <>
      <header
        className="relative isolate overflow-hidden border-b border-line px-4 pb-12 pt-14 text-center"
        style={
          {
            "--cover-m": info.business.coverMobileUrl ? `url(${info.business.coverMobileUrl})` : "none",
            "--cover-d": info.business.coverDesktopUrl ? `url(${info.business.coverDesktopUrl})` : "none",
          } as React.CSSProperties
        }
      >
        {/* Fundo: imagem própria para celular e para desktop (a mesma, se só uma foi enviada) */}
        <div aria-hidden className="absolute inset-0 -z-20 bg-[image:var(--cover-m)] bg-cover bg-center md:bg-[image:var(--cover-d)]" />
        {/* Véu para o texto continuar legível sobre qualquer imagem, mais o brilho das cores da marca */}
        <div
          aria-hidden
          className="absolute inset-0 -z-10"
          style={{
            background:
              `${info.business.coverMobileUrl || info.business.coverDesktopUrl ? "linear-gradient(color-mix(in srgb, var(--color-background) 55%, transparent), color-mix(in srgb, var(--color-background) 80%, transparent)), " : ""}radial-gradient(ellipse 80% 90% at 15% 0%, color-mix(in srgb, var(--color-brand) 38%, transparent), transparent 62%), radial-gradient(ellipse 70% 80% at 90% 10%, color-mix(in srgb, var(--color-accent) 28%, transparent), transparent 60%)`,
          }}
        />
        <div
          role={info.business.logoUrl ? "img" : undefined}
          aria-label={info.business.logoUrl ? `Logo de ${info.business.name}` : undefined}
          className="mx-auto flex h-28 w-28 items-center justify-center overflow-hidden rounded-3xl border border-line bg-surface bg-cover bg-center shadow-xl shadow-black/30"
          style={info.business.logoUrl ? { backgroundImage: `url(${info.business.logoUrl})` } : undefined}
        >
          {!info.business.logoUrl && <Sparkles size={40} className="text-accent" aria-hidden />}
        </div>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">{info.business.name}</h1>
        {info.business.tagline && <p className="mx-auto mt-2 max-w-md text-base text-muted">{info.business.tagline}</p>}
        {info.business.address && (
          <p className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-line bg-surface/70 px-3.5 py-1.5 text-xs text-muted">
            <MapPin size={13} aria-hidden /> {info.business.address}
          </p>
        )}
        <div className="mt-7">
          <a href="#servicos" className="btn-primary px-6">Agendar horário</a>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-10">
      <section id="servicos" className="card mb-5 scroll-mt-6">
        <h2 className="mb-3 font-semibold">1. Escolha o serviço</h2>
        {info.services.length === 0 ? (
          <p className="text-sm text-muted">Agenda ainda não disponível.</p>
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
                    className={`flex w-full items-center justify-between gap-3 rounded-xl border p-3.5 text-left transition ${on ? "border-brand-soft bg-brand/15" : "border-line hover:border-brand-soft/60"}`}
                  >
                    <span>
                      <span className="block font-medium">{s.name}</span>
                      <span className="flex items-center gap-1 text-xs text-muted"><Clock size={12} /> {s.durationMin} min{s.description && ` · ${s.description}`}</span>
                    </span>
                    <span className="flex items-center gap-2 font-medium">{brl(s.priceCents)} {on && <Check size={16} className="text-brand-soft" />}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {selected.length > 0 && (
        <section className="card mb-5">
          <h2 className="mb-1 font-semibold">2. Escolha o dia e o horário</h2>
          <p className="mb-3 text-sm text-muted">Duração total dos serviços: <strong className="text-ink">{fmtDuration(minutes)}</strong></p>

          {avail === null && <InlineSkeleton />}
          {blockedMsg && (
            <p role="alert" className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">{blockedMsg}</p>
          )}
          {avail !== null && (
            <div className="mb-4 flex gap-2 overflow-x-auto pb-2" role="group" aria-label="Dias disponíveis">
              {shownDays.map((d) => (
                <button
                  key={d.date}
                  type="button"
                  disabled={!d.available}
                  title={d.available ? undefined : (d.message ?? undefined)}
                  aria-pressed={date === d.date}
                  onClick={() => setDate(d.date)}
                  className={`shrink-0 rounded-xl border px-3 py-2 text-center text-sm transition disabled:cursor-not-allowed disabled:opacity-35 ${date === d.date ? "border-brand-soft bg-brand/20" : "border-line"}`}
                >
                  <span className="block text-xs text-muted">{["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][weekday(d.date)]}</span>
                  {d.date.slice(8)}/{d.date.slice(5, 7)}
                </button>
              ))}
            </div>
          )}
          {date && slots === null && <p className="text-sm text-muted">Buscando horários…</p>}
          {slots && slots.length === 0 && <p role="status" className="text-sm text-muted">{slotsMsg ?? "Sem horários livres neste dia. Tente outra data."}</p>}
          {slots && slots.length > 0 && (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6" role="group" aria-label="Horários">
              {slots.map((s) => (
                <button key={s} type="button" aria-pressed={slot === s} onClick={() => setSlot(s)} className={`rounded-lg border py-2 text-sm ${slot === s ? "border-brand-soft bg-brand/20" : "border-line hover:border-brand-soft/60"}`}>
                  {hhmm(s)}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {slot && (
        <form onSubmit={submit} className="card space-y-4">
          <h2 className="font-semibold">3. Seus dados</h2>
          <div>
            <label className="label" htmlFor="name">Nome</label>
            <input id="name" name="name" required minLength={2} autoComplete="name" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="phone">WhatsApp (com DDD)</label>
            <input id="phone" name="phone" required type="tel" inputMode="tel" autoComplete="tel" placeholder="(11) 91234-5678" className="input" value={phone} onChange={(e) => setPhone(maskPhone(e.target.value))} />
          </div>
          <div>
            <label className="label" htmlFor="notes">Observações (opcional)</label>
            <input id="notes" name="notes" maxLength={300} className="input" />
          </div>
          <div className="rounded-xl bg-surface-2 p-3.5 text-sm">
            <p className="flex justify-between"><span>Total · {minutes} min</span><strong>{brl(total)}</strong></p>
            <p className="mt-1 flex justify-between text-brand-soft"><span>Sinal para reservar ({info.business.depositPercent}%)</span><strong>{brl(deposit)}</strong></p>
          </div>
          {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
          <button disabled={busy} className="btn-confirm w-full">{busy ? "Reservando…" : "Reservar e pagar o sinal"}</button>
        </form>
      )}
      {!slot && error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      </main>
    </>
  );
}
