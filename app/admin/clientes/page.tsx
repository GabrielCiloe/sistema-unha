"use client";

import { CalendarDays, MessageCircle, MessageSquare } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { PageTitle } from "@/components/admin-shell";
import { useApi } from "@/lib/client";
import { fmtDateTime, formatPhone } from "@/lib/templates";
import { CardGridSkeleton } from "@/components/skeleton";

// A chave de cada cliente é o número do WhatsApp (somente dígitos, com DDI).
type Customer = {
  phone: string;
  name: string;
  createdAt: string;
  _count: { appointments: number };
  appointments: { startsAt: string }[];
};

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

export default function Customers() {
  const [q, setQ] = useState("");
  const path = useMemo(() => `/api/admin/customers${q ? `?q=${encodeURIComponent(q)}` : ""}`, [q]);
  const { data, loading } = useApi<{ customers: Customer[] }>(path);

  return (
    <>
      <PageTitle title="Clientes">
        {data && <span className="text-sm text-muted">{data.customers.length} cliente(s)</span>}
      </PageTitle>
      <label className="label" htmlFor="q">Buscar por nome ou WhatsApp</label>
      <input id="q" className="input mb-5 max-w-sm" value={q} onChange={(e) => setQ(e.target.value)} />

      {loading ? (
        <CardGridSkeleton />
      ) : !data?.customers.length ? (
        <p className="card text-sm text-muted">Nenhuma cliente encontrada. Elas aparecem aqui após o primeiro agendamento.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {data.customers.map((c) => (
            <li key={c.phone} className="card flex flex-col">
              <div className="flex items-center gap-3">
                <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand font-semibold text-on-brand">
                  {initials(c.name)}
                </span>
                <div className="min-w-0">
                  <h2 className="truncate font-semibold">{c.name}</h2>
                  <p className="font-mono text-xs text-brand-soft" title="Número do WhatsApp (identificador do cliente)">{formatPhone(c.phone)}</p>
                </div>
              </div>

              <dl className="mt-4 space-y-1.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <dt className="flex items-center gap-1.5 text-muted"><CalendarDays size={14} /> Agendamentos</dt>
                  <dd className="font-medium">{c._count.appointments}</dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted">Último</dt>
                  <dd>{c.appointments[0] ? fmtDateTime(c.appointments[0].startsAt) : "—"}</dd>
                </div>
              </dl>

              <div className="mt-5 flex gap-2 border-t border-line pt-4">
                <Link className="btn-primary flex-1" href={`/admin/whatsapp?phone=${c.phone}`}><MessageSquare size={15} /> Conversar</Link>
                <a className="btn-ghost" aria-label={`Abrir ${c.name} no WhatsApp`} href={`https://wa.me/${c.phone}`} target="_blank" rel="noreferrer"><MessageCircle size={15} /></a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
