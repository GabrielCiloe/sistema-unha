"use client";

import { Banknote, CalendarDays, Check, FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { PageTitle } from "@/components/admin-shell";
import { Modal } from "@/components/modal";
import { ProofViewer } from "@/components/proof-viewer";
import { PayBadge } from "@/components/status";
import { api, useApi } from "@/lib/client";
import { brl, fmtDateTime } from "@/lib/templates";
import { CardGridSkeleton } from "@/components/skeleton";

type Appt = {
  id: string;
  startsAt: string;
  customer: { name: string; phone: string };
  items: { name: string }[];
  payments: { id: string; status: string; amountCents: number; proofMime: string | null; rejectReason: string | null }[];
};

const FILTERS = [
  ["", "Todos"],
  ["IN_REVIEW", "Em análise"],
  ["PENDING", "Aguardando"],
  ["PAID", "Pagos"],
  ["REJECTED", "Recusados"],
] as const;

export default function Payments() {
  const { data, loading, reload, error: loadError } = useApi<{ appointments: Appt[] }>("/api/admin/appointments?from=2000-01-01&to=2100-01-01");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [proof, setProof] = useState<{ id: string; mime: string; name: string } | null>(null);
  const [confirmedBank, setConfirmedBank] = useState(false);

  const rows = (data?.appointments ?? [])
    .filter((a) => a.payments[0] && (!filter || a.payments[0].status === filter))
    .sort((x, y) => Number(y.payments[0].status === "IN_REVIEW") - Number(x.payments[0].status === "IN_REVIEW"));

  const closeProof = () => {
    setProof(null);
    setConfirmedBank(false);
  };

  async function act(id: string, body: object) {
    try {
      setError("");
      await api(`/api/admin/payments/${id}`, { method: "POST", body });
      closeProof();
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    }
  }

  // Recusa com motivo em popup do próprio sistema (em vez do prompt() do navegador).
  const [rejecting, setRejecting] = useState<string | null>(null);

  // Atualiza a lista sozinha a cada 15 s (comprovantes que chegam pelo WhatsApp), menos enquanto
  // um comprovante ou o popup de recusa está aberto, para não atrapalhar a análise.
  useEffect(() => {
    if (proof || rejecting) return;
    const t = setInterval(reload, 15_000);
    return () => clearInterval(t);
  }, [proof, rejecting, reload]);
  const [reason, setReason] = useState("");
  function reject(id: string) {
    setReason("");
    setRejecting(id);
  }
  async function confirmReject(e: React.FormEvent) {
    e.preventDefault();
    if (!rejecting || reason.trim().length < 3) return;
    await act(rejecting, { action: "reject", reason: reason.trim() });
    setRejecting(null);
  }

  return (
    <>
      <PageTitle title="Pagamentos" />
      <div className="chips mb-5" role="group" aria-label="Filtrar por situação">
        {FILTERS.map(([v, l]) => (
          <button key={v} onClick={() => setFilter(v)} aria-pressed={filter === v} className={filter === v ? "btn-primary" : "btn-ghost"}>{l}</button>
        ))}
      </div>
      {(error || loadError) && <p role="alert" className="mb-3 text-sm text-red-300">{error || loadError}</p>}

      {loading ? (
        <CardGridSkeleton />
      ) : rows.length === 0 ? (
        <p className="card text-sm text-muted">Nenhum pagamento neste filtro.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
          {rows.map((a) => {
            const p = a.payments[0];
            return (
              <li key={p.id} className="card flex flex-col">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold">{a.customer.name}</h2>
                    <p className="truncate text-sm text-muted">{a.items.map((i) => i.name).join(" + ")}</p>
                  </div>
                  <PayBadge status={p.status} />
                </div>

                <p className="mt-4 text-2xl font-semibold">{brl(p.amountCents)}</p>
                <dl className="mt-2 space-y-1 text-sm text-muted">
                  <div className="flex items-center gap-1.5"><Banknote size={14} /> <dd>Pix (comprovante)</dd></div>
                  <div className="flex items-center gap-1.5"><CalendarDays size={14} /> <dd>{fmtDateTime(a.startsAt)}</dd></div>
                </dl>
                {p.rejectReason && <p className="mt-2 text-xs text-red-300">Recusado: {p.rejectReason}</p>}

                <div className="mt-5 flex-1 border-t border-line pt-4">
                  {p.status === "IN_REVIEW" && (
                    <button className="btn-primary w-full" onClick={() => setProof({ id: p.id, mime: p.proofMime ?? "", name: a.customer.name })}>
                      <FileText size={15} /> Analisar comprovante
                    </button>
                  )}
                  {p.status === "PENDING" && (
                    <button
                      className="btn-ghost w-full"
                      onClick={() => confirm("Confirmar recebimento sem comprovante? Só faça se o valor já caiu na conta.") && act(p.id, { action: "approve", confirmedInBank: true })}
                    >
                      <Check size={15} /> Marcar como pago
                    </button>
                  )}
                  {p.status === "PAID" && <p className="text-center text-xs text-muted">Pagamento confirmado.</p>}
                  {p.status === "REJECTED" && <p className="text-center text-xs text-muted">Aguardando novo comprovante.</p>}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {proof && (
        <Modal title={`Comprovante — ${proof.name}`} onClose={closeProof} wide>
          <ProofViewer src={`/api/admin/payments/${proof.id}`} mime={proof.mime} />
          <label className="mt-4 flex items-start gap-2 text-sm">
            <input type="checkbox" checked={confirmedBank} onChange={(e) => setConfirmedBank(e.target.checked)} className="mt-1" />
            Conferi no app do banco que o valor entrou na conta.
          </label>
          <div className="mt-4 flex gap-2">
            <button className="btn-confirm flex-1" disabled={!confirmedBank} onClick={() => act(proof.id, { action: "approve", confirmedInBank: true })}>
              <Check size={15} /> Aprovar
            </button>
            <button className="btn-danger flex-1" onClick={() => reject(proof.id)}>Recusar</button>
          </div>
        </Modal>
      )}
      {rejecting && (
        <Modal title="Recusar comprovante" onClose={() => setRejecting(null)} top>
          <form onSubmit={confirmReject} className="space-y-4">
            <div>
              <label className="label" htmlFor="reject-reason">Motivo da recusa</label>
              <textarea
                id="reject-reason"
                data-autofocus
                rows={3}
                minLength={3}
                maxLength={200}
                required
                className="input"
                placeholder="Ex.: o valor do comprovante não confere com o sinal."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted">A cliente vê esse motivo na página da reserva e pode enviar outro comprovante.</p>
            </div>
            <div className="flex gap-2">
              <button className="btn-danger flex-1" disabled={reason.trim().length < 3}>Recusar comprovante</button>
              <button type="button" className="btn-ghost" onClick={() => setRejecting(null)}>Cancelar</button>
            </div>
          </form>
        </Modal>
      )}

    </>
  );
}
