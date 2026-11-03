"use client";

import { Calendar, CreditCard, LayoutDashboard, LogOut, Menu, MessageCircle, Palette, Scissors, Settings, Users, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
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
  // Celular: menu em gaveta lateral (hambúrguer). Fecha ao navegar, no Esc e ao tocar fora.
  const [open, setOpen] = useState(false); // montado
  const [shown, setShown] = useState(false); // deslizado para dentro (anima entrada e saída)
  const openMenu = () => {
    setOpen(true);
    requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
  };
  const closeMenu = () => setShown(false);
  useEffect(() => closeMenu(), [path]);
  // Depois da animação de saída, desmonta.
  useEffect(() => {
    if (shown || !open) return;
    const t = setTimeout(() => setOpen(false), 250);
    return () => clearTimeout(t);
  }, [shown, open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeMenu();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  // Só a logo, ocupando o espaço (nome fica para leitores de tela). Sem logo enviada, mostra o nome.
  const Brand = ({ bar = false }: { bar?: boolean }) =>
    logoUrl ? (
      <span className={`flex min-w-0 items-center ${bar ? "h-10 flex-1" : "w-full"}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoUrl} alt={businessName} className={bar ? "h-full w-auto max-w-full object-contain object-left" : "h-auto max-h-20 w-full object-contain"} />
      </span>
    ) : (
      <span className="truncate font-semibold">{businessName}</span>
    );

  const links = (big = false) =>
    nav.map(({ href, label, icon: Icon }) => {
      const active = href === "/admin" ? path === href : path.startsWith(href);
      return (
        <Link
          key={href}
          href={href}
          aria-current={active ? "page" : undefined}
          className={`flex items-center gap-3 rounded-xl px-3 transition ${big ? "py-3 text-base" : "py-2.5 text-sm"} ${
            active ? "bg-brand/20 text-brand-soft" : "text-muted hover:bg-surface-2 hover:text-ink"
          }`}
        >
          <Icon size={big ? 20 : 17} /> {label}
        </Link>
      );
    });

  const waBadge = wa?.configured && (
    <Link
      href="/admin/whatsapp"
      className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${waOk ? "border-emerald-500/30 text-emerald-300" : "border-amber-500/40 text-amber-300"}`}
    >
      <span className={`size-2 rounded-full ${waOk ? "bg-emerald-400" : "bg-amber-400"}`} />
      {waOk ? "WhatsApp conectado" : `WhatsApp: ${waLabel(wa.status)[0].toLowerCase()} — conectar`}
    </Link>
  );

  return (
    <div className="min-h-screen md:flex">
      {/* Topo do celular: marca + hambúrguer */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3 md:hidden">
        <Brand bar />
        <ThemeToggle />
        <button type="button" aria-label="Abrir menu" aria-expanded={open} onClick={openMenu} className="rounded-lg p-2 text-ink hover:bg-surface-2">
          <Menu size={24} />
        </button>
      </header>

      {/* Gaveta lateral (celular) */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className={`absolute inset-0 bg-black/50 transition-opacity duration-250 ${shown ? "opacity-100" : "opacity-0"}`} onClick={closeMenu} />
          <div className={`absolute inset-y-0 right-0 flex w-[82%] max-w-sm flex-col bg-surface shadow-2xl transition-transform duration-250 ease-out ${shown ? "translate-x-0" : "translate-x-full"}`}>
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
              <Brand bar />
              <button type="button" aria-label="Fechar menu" onClick={closeMenu} className="rounded-lg p-2 text-ink hover:bg-surface-2"><X size={22} /></button>
            </div>
            <nav aria-label="Principal" className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
              {links(true)}
              <div className="mt-2 border-t border-line pt-3">{waBadge}</div>
            </nav>
            <div className="space-y-3 border-t border-line p-4">
              <p className="truncate text-xs text-muted">{userName}</p>
              <button onClick={logout} className="btn-ghost w-full"><LogOut size={16} /> Sair</button>
            </div>
          </div>
        </div>
      )}

      {/* Barra lateral (desktop) */}
      <aside className="hidden border-r border-line bg-surface md:sticky md:top-0 md:flex md:h-screen md:w-60 md:shrink-0 md:flex-col">
        <div className="flex items-center justify-between px-5 py-5"><Brand /></div>
        <nav aria-label="Principal" className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">{links()}</nav>
        <div className="space-y-2 px-3 pb-4">
          {waBadge}
          <div className="px-1 pt-2">
            <p className="mb-2 truncate text-xs text-muted">{userName}</p>
            <div className="flex gap-2">
              <button onClick={logout} className="btn-ghost flex-1"><LogOut size={15} /> Sair</button>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-x-clip px-3 py-4 md:px-8 md:py-6">{children}</main>
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
