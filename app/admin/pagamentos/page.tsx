"use client";

import { Banknote, CalendarDays, Check, FileText } from "lucide-react";
import { useState } from "react";
import { PageTitle } from "@/components/admin-shell";
import { Modal } from "@/components/modal";
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

  function reject(id: string) {
    const reason = prompt("Motivo da recusa (a cliente poderá reenviar):");
    if (reason && reason.trim().length >= 3) act(id, { action: "reject", reason });
  }

  return (
    <>
      <PageTitle title="Pagamentos" />
      <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Filtrar por situação">
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
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
        <Modal title={`Comprovante — ${proof.name}`} onClose={closeProof}>
          {proof.mime === "application/pdf" ? (
            <iframe title="Comprovante" src={`/api/admin/payments/${proof.id}`} className="h-96 w-full rounded-xl bg-white" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="Comprovante enviado" src={`/api/admin/payments/${proof.id}`} className="mx-auto max-h-96 rounded-xl" />
          )}
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
    </>
  );
}
