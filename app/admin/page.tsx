"use client";

import { CalendarCheck, Clock, Receipt, Users, Wallet } from "lucide-react";
import Link from "next/link";
import { PageTitle } from "@/components/admin-shell";
import { useApi } from "@/lib/client";
import { brl, fmtDateTime } from "@/lib/templates";
import { DashboardSkeleton } from "@/components/skeleton";

type Dash = {
  today: number;
  pendingToday: number;
  inReview: number;
  customers: number;
  monthRevenueCents: number;
  upcoming: { id: string; startsAt: string; customer: { name: string }; items: { name: string }[] }[];
};

export default function Overview() {
  const { data, error, loading } = useApi<Dash>("/api/admin/dashboard");
  if (loading) return <DashboardSkeleton />;
  if (error || !data) return <p role="alert" className="text-red-300">{error}</p>;

  const stats = [
    { label: "Atendimentos hoje", value: data.today, icon: CalendarCheck },
    { label: "Aguardando sinal hoje", value: data.pendingToday, icon: Clock },
    { label: "Comprovantes p/ analisar", value: data.inReview, icon: Receipt, href: "/admin/pagamentos" },
    { label: "Sinais recebidos no mês", value: brl(data.monthRevenueCents), icon: Wallet },
    { label: "Clientes", value: data.customers, icon: Users, href: "/admin/clientes" },
  ];

  return (
    <>
      <PageTitle title="Visão geral" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        {stats.map(({ label, value, icon: Icon, href }) => {
          const body = (
            <div className="card flex h-full items-center justify-between gap-3 transition hover:border-brand-soft/60">
              <div className="min-w-0">
                <p className="text-3xl font-bold tracking-tight">{value}</p>
                <p className="mt-1 text-sm text-muted">{label}</p>
              </div>
              <span aria-hidden className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-brand/15 text-brand-soft">
                <Icon size={28} />
              </span>
            </div>
          );
          return href ? <Link key={label} href={href} className="block">{body}</Link> : <div key={label}>{body}</div>;
        })}
      </div>

      <section className="mt-8" aria-labelledby="proximos">
        <h2 id="proximos" className="mb-4 text-lg font-semibold">Próximos atendimentos confirmados</h2>
        {data.upcoming.length === 0 ? (
          <p className="card text-sm text-muted">Nenhum atendimento confirmado à frente.</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.upcoming.map((a) => (
              <li key={a.id} className="card flex flex-col gap-3">
                <p className="inline-flex w-fit items-center gap-1.5 rounded-full bg-brand/15 px-3 py-1 text-sm font-medium text-brand-soft">
                  <CalendarCheck size={14} aria-hidden /> {fmtDateTime(a.startsAt)}
                </p>
                <div className="min-w-0">
                  <p className="truncate font-semibold">{a.customer.name}</p>
                  <p className="truncate text-sm text-muted">{a.items.map((i) => i.name).join(" + ")}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
