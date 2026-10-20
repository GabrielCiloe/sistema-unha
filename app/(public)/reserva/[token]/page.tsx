"use client";

import { Check, Copy, Upload } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { use, useEffect, useState } from "react";
import { PayBadge } from "@/components/status";
import { api } from "@/lib/client";
import { brl, fmtDateTime } from "@/lib/templates";
import { BookingSkeleton } from "@/components/skeleton";

type Booking = {
  business: { name: string; address: string };
  appointment: { status: string; startsAt: string; totalCents: number; depositCents: number; customerName: string; items: { name: string; priceCents: number }[] };
  payment: { id: string; status: string; amountCents: number; pixPayload: string | null; rejectReason: string | null } | null;
};

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

  if (!data) return error ? <p role="alert" className="p-8 text-center text-red-300">{error}</p> : <BookingSkeleton />;
  const { appointment: a, payment: p } = data;
  const needsPayment = a.status === "PENDING_PAYMENT" && p && ["PENDING", "REJECTED"].includes(p.status);

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="mb-1 text-xl font-semibold">{data.business.name}</h1>
      <p className="mb-6 text-sm text-muted">Olá, {a.customerName}!</p>

      <section className="card mb-5 text-sm">
        <p className="font-medium">{a.items.map((i) => i.name).join(" + ")}</p>
        <p className="mt-1 text-brand-soft">{fmtDateTime(a.startsAt)}</p>
        {data.business.address && <p className="mt-1 text-muted">{data.business.address}</p>}
        <p className="mt-3 flex justify-between"><span>Total</span><strong>{brl(a.totalCents)}</strong></p>
      </section>

      {a.status === "CONFIRMED" && (
        <div role="status" className="card text-center" style={{ borderColor: "var(--color-confirm)" }}>
          <Check className="mx-auto mb-2" style={{ color: "var(--color-confirm)" }} />
          <p className="font-semibold">Horário confirmado!</p>
          <p className="mt-1 text-sm text-muted">Você receberá a confirmação no WhatsApp.</p>
        </div>
      )}
      {a.status === "CANCELLED" && <p role="status" className="card text-center text-sm text-muted">Esta reserva foi cancelada ou expirou. Faça um novo agendamento.</p>}

      {needsPayment && p && (
        <section className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Pague o sinal: {brl(p.amountCents)}</h2>
            <PayBadge status={p.status} />
          </div>
          {p.rejectReason && <p role="alert" className="text-sm text-red-300">Comprovante recusado: {p.rejectReason}. Envie outro.</p>}

          {p.pixPayload && (
            <>
              <div className="rounded-xl bg-white p-3"><QRCodeSVG value={p.pixPayload} size={200} className="mx-auto" /></div>
              <button
                className="btn-ghost w-full"
                onClick={async () => {
                  await navigator.clipboard.writeText(p.pixPayload!);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2500);
                }}
              >
                <Copy size={15} /> {copied ? "Código copiado!" : "Copiar Pix copia e cola"}
              </button>
              <div>
                <p className="mb-2 text-sm text-muted">Depois de pagar, envie o comprovante (PNG, JPG ou PDF até 2 MB):</p>
                <label className="btn-confirm w-full cursor-pointer">
                  <Upload size={15} /> {uploading ? "Enviando…" : "Enviar comprovante"}
                  <input type="file" accept="image/png,image/jpeg,application/pdf" className="sr-only" disabled={uploading} onChange={(e) => upload(e.target.files?.[0])} />
                </label>
              </div>
              <p className="text-xs text-muted">Sua vaga fica reservada por 30 minutos.</p>
            </>
          )}
        </section>
      )}

      {a.status === "PENDING_PAYMENT" && p?.status === "IN_REVIEW" && (
        <p role="status" className="card text-center text-sm">Comprovante recebido. Estamos conferindo o pagamento — você será avisada no WhatsApp.</p>
      )}
      {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}
    </main>
  );
}
