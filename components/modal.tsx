"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";

// Popup acessível: Esc e clique no fundo fecham, foco volta ao elemento anterior e fica preso dentro.
// `top`: para um popup aberto por cima de outro (ex.: motivo da recusa sobre o comprovante).
// `footer`: barra fixa no rodapé (botões), enquanto o conteúdo rola; o título e o X ficam fixos no topo.
export function Modal({ title, onClose, children, wide = false, top = false, footer }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean; top?: boolean; footer?: React.ReactNode }) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  // Referência estável: o efeito abaixo roda só ao abrir/fechar (senão o foco voltaria ao 1º campo a cada tecla).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(box.current?.querySelectorAll<HTMLElement>('input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])') ?? []).filter((e) => !e.hasAttribute("disabled"));
    (box.current?.querySelector<HTMLElement>("[data-autofocus]") ?? focusables()[1] ?? focusables()[0])?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return closeRef.current();
      if (e.key !== "Tab") return;
      const f = focusables();
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);

  return (
    <div className={`fixed inset-0 flex items-end justify-center bg-black/60 p-0 backdrop-blur-md sm:items-center sm:p-4 ${top ? "z-[60]" : "z-50"}`} onMouseDown={(e) => e.target === e.currentTarget && closeRef.current()}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`flex max-h-[80vh] w-full flex-col rounded-t-2xl border border-line bg-surface sm:rounded-2xl ${wide ? "max-w-3xl" : "max-w-lg"}`}>
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
          <button type="button" aria-label="Fechar" onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink"><X size={18} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="shrink-0 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}
