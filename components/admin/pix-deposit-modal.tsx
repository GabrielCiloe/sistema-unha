"use client";

import { CheckCircle2, Copy, Send } from "lucide-react";
import { useState } from "react";
import { Modal } from "@/components/modal";
import { toast } from "@/components/toast";
import { api } from "@/lib/client";
import { brl, fmtDateTime, formatPhone } from "@/lib/templates";

export type PixAppointment = { id: string; startsAt: string; customer: { name: string; phone: string } };
export type PixPayment = { id: string; amountCents: number; pixPayload: string };

// Tela do Pix do sinal de um agendamento que aguarda pagamento: copia e cola, envio pelo WhatsApp e
// "sinal já recebido". Usada logo depois de criar o agendamento interno e pelo botão "Pix do sinal" da agenda.
// `sticky`: Esc e clique no fundo não fecham (só o botão do rodapé e o X), para a dona não perder o código sem querer.
export function PixDepositModal({
  title,
  closeLabel,
  appointment: a,
  payment,
  sticky = false,
  internal = false,
  onClose,
  onChanged,
}: {
  title: string;
  closeLabel: string;
  appointment: PixAppointment;
  payment: PixPayment;
  sticky?: boolean;
  // Agendamento interno (source ADMIN): a vaga fica reservada até o horário do atendimento, sem o prazo de 30 min.
  internal?: boolean;
  onClose: () => void;
  // Chamado quando o sinal é marcado como recebido (a agenda recarrega).
  onChanged: () => void;
}) {
  const [paid, setPaid] = useState(false);
  const [acting, setActing] = useState("");
  const [error, setError] = useState("");

  async function copyPix() {
    try {
      await navigator.clipboard.writeText(payment.pixPayload);
      toast("Pix copia e cola copiado.");
    } catch {
      toast("Não foi possível copiar. Selecione o código e copie manualmente.", false);
    }
  }

  async function sendPix() {
    setActing("send");
    setError("");
    try {
      const r = await api<{ whatsappSent: boolean }>(`/api/admin/appointments/${a.id}/send-pix`, { method: "POST" });
      toast(r.whatsappSent ? "Reserva e Pix copia e cola enviados pelo WhatsApp." : "O WhatsApp não está conectado: a mensagem não foi enviada. Copie o código e envie por outro meio.", r.whatsappSent);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    } finally {
      setActing("");
    }
  }

  // Sinal recebido em mãos: mesmo caminho da aprovação em Pagamentos (confirmPayment).
  async function markPaid() {
    if (!confirm(`Confirmar que o sinal de ${brl(payment.amountCents)} já foi recebido? O agendamento fica confirmado e a cliente é avisada no WhatsApp.`)) return;
    setActing("paid");
    setError("");
    try {
      await api(`/api/admin/payments/${payment.id}`, { method: "POST", body: { action: "approve", confirmedInBank: true } });
      setPaid(true);
      onChanged();
      toast("Sinal marcado como recebido. Agendamento confirmado.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    } finally {
      setActing("");
    }
  }

  return (
    <Modal title={title} onClose={onClose} onDismiss={sticky ? () => {} : undefined} top footer={<button type="button" className="btn-primary w-full" onClick={onClose}>{closeLabel}</button>}>
      <div className="rounded-xl border border-line bg-background p-3.5">
        <p className="font-semibold">{a.customer.name}</p>
        <p className="font-mono text-xs text-brand-soft">{formatPhone(a.customer.phone)}</p>
        <p className="mt-1 text-sm text-muted first-letter:uppercase">{fmtDateTime(a.startsAt)}</p>
        <p className="text-sm text-muted">Sinal: {brl(payment.amountCents)}</p>
      </div>

      {paid ? (
        <p role="status" className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3.5 text-sm text-emerald-300">
          <CheckCircle2 size={18} className="shrink-0" aria-hidden /> Sinal recebido. O agendamento está confirmado.
        </p>
      ) : (
        <>
          <label className="label mt-4" htmlFor="pix-code">Pix copia e cola do sinal</label>
          <textarea id="pix-code" readOnly rows={4} value={payment.pixPayload} onFocus={(e) => e.currentTarget.select()} className="input resize-none break-all font-mono text-xs" />
          <p className="mt-1.5 text-xs text-muted">
            Envie este código à cliente.{internal ? " A vaga fica reservada até o horário do atendimento; se o sinal não for confirmado até lá, o agendamento é cancelado." : ""} Este código continua disponível na agenda, em “Pix do sinal”.
          </p>
          {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <button type="button" className="btn-primary" data-autofocus onClick={copyPix}><Copy size={16} /> Copiar Pix copia e cola</button>
            <button type="button" className="btn-ghost" disabled={acting !== ""} onClick={sendPix}><Send size={16} /> {acting === "send" ? "Enviando…" : "Enviar pelo WhatsApp"}</button>
            <button type="button" className="btn-confirm sm:col-span-2" disabled={acting !== ""} onClick={markPaid}><CheckCircle2 size={16} /> {acting === "paid" ? "Confirmando…" : "Marcar sinal como já recebido"}</button>
          </div>
        </>
      )}
    </Modal>
  );
}
