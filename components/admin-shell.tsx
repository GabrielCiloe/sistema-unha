"use client";

import { Calendar, CreditCard, LayoutDashboard, LogOut, MessageCircle, Palette, Scissors, Settings, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { Toaster } from "@/components/toast";
import { api } from "@/lib/client";
import { useWaStatus, waLabel } from "@/components/whatsapp-connection";

const nav = [
  { href: "/admin", label: "Visão geral", icon: LayoutDashboard },
  { href: "/admin/agenda", label: "Agenda", icon: Calendar },
  { href: "/admin/pagamentos", label: "Pagamentos", icon: CreditCard },
  { href: "/admin/servicos", label: "Serviços", icon: Scissors },
  { href: "/admin/clientes", label: "Clientes", icon: Users },
  { href: "/admin/whatsapp", label: "WhatsApp", icon: MessageCircle },
  { href: "/admin/personalizacao", label: "Personalização", icon: Palette },
  { href: "/admin/configuracoes", label: "Configurações", icon: Settings },
];

export function AdminShell({ userName, businessName, logoUrl, children }: { userName: string; businessName: string; logoUrl: string | null; children: React.ReactNode }) {
  const path = usePathname();
  const { state: wa } = useWaStatus(15000);
  const waOk = wa?.status === "CONNECTED";
  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }
  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-line bg-surface md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:border-b-0 md:border-r">
        <div className="hidden items-center justify-between px-5 py-5 md:flex">
          <span className="flex min-w-0 items-center gap-2.5 font-semibold">
            {logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="size-9 shrink-0 rounded-lg border border-line bg-background object-contain p-0.5" />
            )}
            <span className="truncate">{businessName}</span>
          </span>
        </div>
        <nav aria-label="Principal" className="flex gap-1 overflow-x-auto p-2 md:flex-col md:p-3">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = href === "/admin" ? path === href : path.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition ${
                  active ? "bg-brand/20 text-brand-soft" : "text-muted hover:bg-surface-2 hover:text-ink"
                }`}
              >
                <Icon size={17} /> {label}
              </Link>
            );
          })}
          <button onClick={logout} className="flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-muted md:hidden">
            <LogOut size={17} /> Sair
          </button>
        </nav>
        {wa?.configured && (
          <Link
            href="/admin/whatsapp"
            className={`mx-3 mb-2 hidden items-center gap-2 rounded-xl border px-3 py-2 text-xs md:flex md:absolute md:bottom-[92px] md:left-0 md:right-0 ${waOk ? "border-emerald-500/30 text-emerald-300" : "border-amber-500/40 text-amber-300"}`}
          >
            <span className={`size-2 rounded-full ${waOk ? "bg-emerald-400" : "bg-amber-400"}`} />
            {waOk ? "WhatsApp conectado" : `WhatsApp: ${waLabel(wa.status)[0].toLowerCase()} — conectar`}
          </Link>
        )}
        <div className="hidden px-4 py-4 md:absolute md:bottom-0 md:block md:w-60">
          <p className="mb-2 truncate text-xs text-muted">{userName}</p>
          <div className="flex gap-2">
            <button onClick={logout} className="btn-ghost flex-1"><LogOut size={15} /> Sair</button>
            <ThemeToggle />
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</main>
      <ThemeToggle className="fixed bottom-4 right-4 z-30 shadow-lg md:hidden" />
      <Toaster />
    </div>
  );
}

export function PageTitle({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-semibold">{title}</h1>
      {children}
    </div>
  );
}
