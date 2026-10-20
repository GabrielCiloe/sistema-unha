"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type Mode = "dark" | "light";

// Script que roda antes da pintura (no <head>) para não piscar o tema errado.
export const MODE_SCRIPT = `try{var m=localStorage.getItem("mode");if(m!=="light"&&m!=="dark")m="dark";document.documentElement.dataset.mode=m}catch(e){document.documentElement.dataset.mode="dark"}`;

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [mode, setMode] = useState<Mode | null>(null);

  useEffect(() => {
    setMode(document.documentElement.dataset.mode === "light" ? "light" : "dark");
  }, []);

  function toggle() {
    const next: Mode = mode === "light" ? "dark" : "light";
    document.documentElement.dataset.mode = next;
    try {
      localStorage.setItem("mode", next);
    } catch {
      /* sem armazenamento: vale só nesta visita */
    }
    setMode(next);
  }

  const light = mode === "light";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={light ? "Ativar modo escuro" : "Ativar modo claro"}
      title={light ? "Modo escuro" : "Modo claro"}
      className={`inline-flex size-10 items-center justify-center rounded-xl border border-line bg-surface-2 text-ink transition hover:border-brand-soft ${className}`}
    >
      {mode === null ? null : light ? <Moon size={18} /> : <Sun size={18} />}
    </button>
  );
}
