"use client";

import { CircleCheck, Copy, MapPin, Upload } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { use, useEffect, useState } from "react";
import { BrandHeader } from "@/components/brand-header";
import { api } from "@/lib/client";
import { brl, fmtDateTime } from "@/lib/templates";
import { BookingSkeleton } from "@/components/skeleton";
import { rememberBooking } from "@/components/pwa";

type Booking = {
  business: { name: string; address: string; logoUrl: string | null; whatsapp: string | null; mapsUrl: string | null };
  appointment: { status: string; startsAt: string; holdUntil: string; totalCents: number; depositCents: number; customerName: string; items: { name: string; priceCents: number }[] };
  payment: { id: string; status: string; amountCents: number; pixPayload: string | null; rejectReason: string | null } | null;
};

// "Quarta - feira, 03/11/2026, 09:30" (formato do Figma)
const fmtLong = (iso: string) => {
  const d = new Date(iso);
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", ...o }).format(d);
  const wd = f({ weekday: "long" }).replace("-feira", " - feira");
  return `${wd.charAt(0).toUpperCase()}${wd.slice(1)}, ${f({ day: "2-digit", month: "2-digit", year: "numeric" })}, ${f({ hour: "2-digit", minute: "2-digit" })}`;
};

// Cartão de aviso do Figma: fundo quase branco, borda suave, sombra e ícone de check em caixa rosé.
function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="flex items-center gap-[10px] rounded-[10px] border border-accent/50 bg-[#fbfafd] px-[15px] py-[25px] shadow-[0_4px_2px_rgba(0,0,0,0.25)]">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[4px] bg-accent/5 text-brand"><CircleCheck size={24} fill="currentColor" className="text-brand [&>path]:stroke-white" aria-hidden /></span>
      <p className="text-[14px] font-medium leading-[1.4] text-ink">{children}</p>
    </div>
  );
}

export default function BookingStatus({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [data, setData] = useState<Booking | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function load() {
    try {
      setData(await api<Booking>(`/api/public/bookings/${token}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    }
  }

  useEffect(() => {
    rememberBooking(token); // o "Compartilhar" do app instalado usa para achar esta reserva
    load();
    const t = setInterval(load, 8000); // pega a aprovação do comprovante
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      await api(`/api/public/bookings/${token}/proof`, { method: "POST", body: fd });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    } finally {
      setUploading(false);
    }
  }

  if (!data) return error ? <p role="alert" className="p-8 text-center text-red-700">{error}</p> : <BookingSkeleton />;
  const { appointment: a, payment: p } = data;
  const needsPayment = a.status === "PENDING_PAYMENT" && p && ["PENDING", "REJECTED"].includes(p.status);

  return (
    <>
      <BrandHeader name={data.business.name} logoUrl={data.business.logoUrl} />
      <main className="mx-auto max-w-[390px] space-y-[15px] px-5 pb-20">
        <section className="flex items-end justify-between gap-3 rounded-[10px] border-2 border-brand bg-brand/10 px-4 py-[15px] leading-[1.4]">
          <div className="min-w-0">
            <p className="text-[14px] font-bold text-ink">{a.items.map((i) => i.name).join(" + ")}</p>
            <p className="text-[12px] text-ink/35">{fmtLong(a.startsAt)}</p>
            {data.business.address && <p className="text-[12px] text-ink/35">{data.business.address}</p>}
            <p className="text-[14px] font-bold text-ink">Total</p>
          </div>
          <p className="shrink-0 text-[14px] font-bold text-ink">{brl(a.totalCents)}</p>
        </section>

        {a.status === "CONFIRMED" && (
          <>
            <Notice>Horário confirmado, {a.customerName}!<br />Você também recebe a confirmação pelo WhatsApp.</Notice>
            {data.business.mapsUrl && (
              <a href={data.business.mapsUrl} target="_blank" rel="noopener" className="btn-fill w-full py-3">
                <MapPin size={20} strokeWidth={1.5} /> Como chegar
              </a>
            )}
          </>
        )}
        {a.status === "CANCELLED" && <p role="status" className="pcard text-center text-sm text-muted">Esta reserva foi cancelada ou o prazo do sinal acabou. Entre em contato pelo WhatsApp do estúdio ou faça um novo agendamento.</p>}
        {a.status === "PENDING_PAYMENT" && p?.status === "IN_REVIEW" && (
          <Notice>Comprovante recebido.<br />Estamos conferindo o pagamento, você receberá a confirmação pelo WhatsApp</Notice>
        )}

        {needsPayment && p && (
          <section className="pcard space-y-5">
            <h2 className="text-[16px] font-semibold text-ink">Pague o sinal: {brl(p.amountCents)}</h2>
            {p.rejectReason && <p role="alert" className="text-sm text-red-700">Comprovante recusado: {p.rejectReason}. Envie outro.</p>}
            {p.pixPayload && (
              <>
                <div className="rounded-[10px] bg-white"><QRCodeSVG value={p.pixPayload} size={200} className="mx-auto" /></div>
                <button
                  type="button"
                  className="btn-outline w-full"
                  onClick={async () => {
                    await navigator.clipboard.writeText(p.pixPayload!);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2500);
                  }}
                >
                  <Copy size={20} strokeWidth={1.5} /> {copied ? "Código copiado!" : "Copiar Pix copia e cola"}
                </button>
                <p className="text-[14px] leading-[1.4] text-ink/35">Depois de pagar, envie o comprovante.</p>
                <label className="btn-fill w-full cursor-pointer py-3">
                  <Upload size={20} strokeWidth={1.5} /> {uploading ? "Enviando…" : "Enviar comprovante"}
                  <input type="file" accept="image/png,image/jpeg,application/pdf" className="sr-only" disabled={uploading} onChange={(e) => upload(e.target.files?.[0])} />
                </label>
                <p className="text-[12px] leading-[1.4] text-ink/35">
                  Foto (PNG ou JPG) ou PDF até 50 MB. Sua vaga fica reservada até {new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(a.holdUntil))}
                  {new Date(a.holdUntil).getTime() < Date.now() ? " (prazo encerrado: envie agora, se a vaga ainda estiver livre)" : ""}.
                </p>
              </>
            )}
          </section>
        )}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </main>
    </>
  );
}
