"use client";

import { FileText, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { BrandHeader } from "@/components/brand-header";
import { BookingSkeleton } from "@/components/skeleton";
import { recentBookings } from "@/components/pwa";
import { api } from "@/lib/client";
import { brl, fmtDateTime } from "@/lib/templates";

// Destino do "Compartilhar" do app instalado: o service worker guardou o arquivo no cache;
// aqui descobrimos a reserva (pelas reservas abertas neste aparelho) e enviamos o comprovante.
const SHARE_CACHE = "compartilhar-v1";

type Booking = {
  business: { name: string; logoUrl: string | null };
  appointment: { status: string; startsAt: string; depositCents: number; items: { name: string }[] };
  payment: { status: string; amountCents: number } | null;
};
type Pending = Booking & { token: string };

async function takeSharedFile(): Promise<File | null> {
  if (!("caches" in window)) return null;
  const cache = await caches.open(SHARE_CACHE);
  const [res, info] = await Promise.all([cache.match("/compartilhar/arquivo"), cache.match("/compartilhar/info")]);
  if (!res) return null;
  const meta = info ? ((await info.json().catch(() => ({}))) as { name?: string; type?: string }) : {};
  const blob = await res.blob();
  return new File([blob], meta.name || "comprovante", { type: meta.type || blob.type });
}

async function clearShared() {
  if (!("caches" in window)) return;
  const cache = await caches.open(SHARE_CACHE);
  await Promise.all([cache.delete("/compartilhar/arquivo"), cache.delete("/compartilhar/info")]);
}

export default function Compartilhar() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [pending, setPending] = useState<Pending[] | null>(null);
  const [brand, setBrand] = useState<{ name: string; logoUrl: string | null } | null>(null);
  const [chosen, setChosen] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("erro") === "sw") setNotice("O app ainda estava sendo preparado e o arquivo não chegou. Compartilhe o comprovante de novo.");
    else if (q.get("erro")) setNotice("Não foi possível ler o arquivo compartilhado. Tente de novo ou envie pela página da reserva.");
    else if (q.get("sem-arquivo")) setNotice("O app do banco compartilhou só um texto, sem o arquivo. Use a opção de compartilhar o comprovante como imagem ou PDF.");

    (async () => {
      api<{ business: { name: string; logoUrl: string | null } }>("/api/public/info").then((r) => setBrand(r.business)).catch(() => {});
      const f = await takeSharedFile().catch(() => null);
      setFile(f);
      if (f && f.type.startsWith("image/")) setPreview(URL.createObjectURL(f));
      const found: Pending[] = [];
      for (const token of recentBookings()) {
        try {
          const b = await api<Booking>(`/api/public/bookings/${token}`);
          if (b.appointment.status === "PENDING_PAYMENT" && b.payment && ["PENDING", "REJECTED"].includes(b.payment.status)) found.push({ ...b, token });
        } catch {}
      }
      setPending(found);
      if (found.length) setChosen(found[0].token);
    })();
  }, []);

  async function send() {
    if (!file || !chosen) return;
    setSending(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      await api(`/api/public/bookings/${chosen}/proof`, { method: "POST", body: fd });
      await clearShared();
      window.location.href = `/reserva/${chosen}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao enviar.");
      setSending(false);
    }
  }

  if (pending === null) return <BookingSkeleton />;

  return (
    <>
      <BrandHeader name={brand?.name ?? ""} logoUrl={brand?.logoUrl ?? null} />
      <main className="mx-auto max-w-[390px] space-y-[15px] px-5 pb-20">
        <section className="pcard space-y-4">
          <h2 className="text-[16px] font-semibold text-ink">Enviar comprovante</h2>
          {notice && <p role="alert" className="text-sm text-amber-700">{notice}</p>}

          {file ? (
            preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Comprovante compartilhado" className="max-h-72 w-full rounded-[10px] border border-line object-contain" />
            ) : (
              <p className="flex items-center gap-2 rounded-[10px] border border-line p-3 text-sm text-ink"><FileText size={20} /> {file.name}</p>
            )
          ) : (
            !notice && <p className="text-sm text-ink/60">Nenhum arquivo recebido. No app do banco, abra o comprovante, toque em Compartilhar e escolha este app.</p>
          )}

          {pending.length === 0 ? (
            <p className="text-sm text-ink/60">
              Não encontramos neste celular uma reserva aguardando o sinal. Abra o link da reserva que você recebeu pelo WhatsApp e envie o comprovante por lá.
            </p>
          ) : (
            <fieldset className="space-y-2">
              <legend className="mb-2 text-[14px] text-ink/60">{pending.length > 1 ? "Para qual reserva é o comprovante?" : "Reserva"}</legend>
              {pending.map((b) => (
                <label key={b.token} className={`flex cursor-pointer items-start gap-3 rounded-[10px] border p-3 ${chosen === b.token ? "border-brand bg-brand/10" : "border-line"}`}>
                  <input type="radio" name="reserva" className="mt-1" checked={chosen === b.token} onChange={() => setChosen(b.token)} />
                  <span className="min-w-0 text-[14px] leading-[1.4] text-ink">
                    <span className="block font-semibold">{b.appointment.items.map((i) => i.name).join(" + ")}</span>
                    <span className="block text-ink/60">{fmtDateTime(b.appointment.startsAt)}</span>
                    <span className="block">Sinal: {brl(b.payment!.amountCents)}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}

          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          {file && pending.length > 0 && (
            <button type="button" className="btn-fill w-full py-3" disabled={sending} onClick={send}>
              <Upload size={20} strokeWidth={1.5} /> {sending ? "Enviando…" : "Enviar comprovante"}
            </button>
          )}
          {pending.length > 0 && !file && (
            <a href={`/reserva/${chosen}`} className="btn-outline w-full">Abrir minha reserva</a>
          )}
        </section>
      </main>
    </>
  );
}
