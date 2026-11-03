"use client";

import { Download, Share, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";

// PWA: registra o service worker e guarda o convite de instalação do Chrome (o evento chega cedo,
// antes de a página da reserva montar), para o botão "Instalar app" usar depois.
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
declare global {
  interface Window {
    __installPrompt?: InstallPrompt | null;
  }
}

const RESERVAS_KEY = "unha:reservas";

export function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator && window.isSecureContext) navigator.serviceWorker.register("/sw.js").catch(() => {});
    const onPrompt = (e: Event) => {
      e.preventDefault();
      window.__installPrompt = e as InstallPrompt;
      window.dispatchEvent(new Event("pwa:installable"));
    };
    const onInstalled = () => {
      window.__installPrompt = null;
      window.dispatchEvent(new Event("pwa:installable"));
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return null;
}

// Reservas abertas neste aparelho (mais recente primeiro): a página /compartilhar usa para saber
// a qual reserva o comprovante compartilhado pertence.
export function rememberBooking(token: string) {
  try {
    const list = recentBookings().filter((t) => t !== token);
    localStorage.setItem(RESERVAS_KEY, JSON.stringify([token, ...list].slice(0, 5)));
  } catch {}
}

export function recentBookings(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RESERVAS_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((t) => typeof t === "string" && /^[\w-]{8,100}$/.test(t)) : [];
  } catch {
    return [];
  }
}

const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

// Botão flutuante "Instalar app" (canto inferior direito, cor dos botões, ícone branco) para quem ainda
// não instalou. Android/Chrome: abre o convite de instalação. iPhone: o Safari não tem esse convite,
// então mostra como usar "Adicionar à Tela de Início".
export function InstallFab() {
  const [mode, setMode] = useState<"prompt" | "ios" | null>(null);
  const [help, setHelp] = useState(false);
  useEffect(() => {
    const sync = () => setMode(isStandalone() ? null : window.__installPrompt ? "prompt" : isIos() ? "ios" : null);
    sync();
    window.addEventListener("pwa:installable", sync);
    return () => window.removeEventListener("pwa:installable", sync);
  }, []);
  useEffect(() => {
    if (!help) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setHelp(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [help]);

  if (!mode) return null;
  return (
    <>
      <button
        type="button"
        aria-label="Instalar app"
        title="Instalar app"
        onClick={async () => {
          if (mode === "ios") return setHelp(true);
          const p = window.__installPrompt;
          if (!p) return;
          await p.prompt();
          await p.userChoice;
          window.__installPrompt = null;
          setMode(null);
        }}
        className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-40 flex size-14 items-center justify-center rounded-full bg-accent text-white shadow-[0_6px_16px_rgba(0,0,0,0.25)] transition hover:brightness-110 active:scale-95"
      >
        <Download size={24} strokeWidth={2} aria-hidden />
      </button>
      {help && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={() => setHelp(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="ios-install-title" className="w-full max-w-sm space-y-3 rounded-[10px] bg-surface p-5 text-ink shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 id="ios-install-title" className="text-[16px] font-semibold">Instalar o app no iPhone</h2>
            <ol className="list-decimal space-y-2 pl-5 text-[14px] leading-[1.4]">
              <li>
                Toque em Compartilhar <Share size={16} className="inline align-text-bottom" aria-label="ícone de compartilhar" /> na barra do navegador.
              </li>
              <li>Escolha <strong>Adicionar à Tela de Início</strong>.</li>
              <li>Toque em <strong>Adicionar</strong>.</li>
            </ol>
            <button type="button" autoFocus className="btn-fill w-full" onClick={() => setHelp(false)}>Entendi</button>
          </div>
        </div>
      )}
    </>
  );
}

// Cartão "Instale o app": só aparece quando o navegador oferece instalação (Android/Chrome) e o app
// ainda não está instalado. No iPhone o "Compartilhar para um site" não existe, então não aparece.
export function InstallAppCard() {
  const [can, setCan] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    const sync = () => setCan(!!window.__installPrompt && !isStandalone());
    sync();
    window.addEventListener("pwa:installable", sync);
    return () => window.removeEventListener("pwa:installable", sync);
  }, []);

  if (done) return <p role="status" className="text-center text-[12px] leading-[1.4] text-ink/60">App instalado. No app do banco, toque em Compartilhar no comprovante e escolha o app do estúdio.</p>;
  if (!can) return null;
  return (
    <div className="space-y-2 rounded-[10px] border border-accent/40 bg-accent/5 p-4">
      <p className="text-[14px] font-medium leading-[1.4] text-ink">Instale o app do estúdio</p>
      <p className="text-[12px] leading-[1.4] text-ink/60">Assim ele aparece no botão Compartilhar do app do banco e o comprovante vai direto para a sua reserva.</p>
      <button
        type="button"
        className="btn-outline w-full"
        onClick={async () => {
          const p = window.__installPrompt;
          if (!p) return;
          await p.prompt();
          const { outcome } = await p.userChoice;
          window.__installPrompt = null;
          setCan(false);
          if (outcome === "accepted") setDone(true);
        }}
      >
        <Smartphone size={20} strokeWidth={1.5} /> Instalar app
      </button>
    </div>
  );
}
