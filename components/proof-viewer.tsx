"use client";

import { ExternalLink, Maximize2, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const MIN = 0.5;
const MAX = 6;
const STEP = 1.25;

// Visualizador do comprovante (imagem ou PDF) com zoom e arrastar para navegar.
// Zoom: botões, roda do mouse (ou Ctrl+roda) e pinça no celular. Navegação: arrastar com o mouse ou o dedo.
// No PDF, uma camada transparente captura o arraste (senão o iframe engole os eventos).
export function ProofViewer({ src, mime }: { src: string; mime: string }) {
  const isPdf = mime === "application/pdf";
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; scale: number } | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const clamp = (s: number) => Math.min(MAX, Math.max(MIN, s));

  // Aplica o zoom mantendo o ponto (cx, cy) do viewport parado.
  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    setScale((s) => {
      const next = clamp(s * factor);
      const k = next / s;
      if (cx !== undefined && cy !== undefined && box.current) {
        const r = box.current.getBoundingClientRect();
        const ox = cx - r.left - r.width / 2;
        const oy = cy - r.top - r.height / 2;
        setPos((p) => ({ x: ox - (ox - p.x) * k, y: oy - (oy - p.y) * k }));
      }
      return next;
    });
  }, []);

  const reset = () => {
    setScale(1);
    setPos({ x: 0, y: 0 });
  };

  // Roda do mouse: zoom em volta do cursor (preventDefault exige listener não passivo).
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.deltaY < 0 ? STEP : 1 / STEP, e.clientX, e.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  function onPointerDown(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale };
      drag.current = null;
    }
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && gesture.current) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      setScale(clamp((gesture.current.scale * d) / gesture.current.dist));
      return;
    }
    if (drag.current) setPos({ x: drag.current.px + (e.clientX - drag.current.x), y: drag.current.py + (e.clientY - drag.current.y) });
  }
  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
    if (pointers.current.size === 0) drag.current = null;
    else if (pointers.current.size === 1) {
      const [p] = [...pointers.current.values()];
      drag.current = { x: p.x, y: p.y, px: pos.x, py: pos.y };
    }
  }

  const handlers = { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp };
  const pct = Math.round(scale * 100);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button type="button" className="btn-ghost px-2.5" aria-label="Diminuir zoom" onClick={() => zoomAt(1 / STEP)}><Minus size={15} /></button>
          <span className="w-14 text-center text-sm tabular-nums text-muted" aria-live="polite">{pct}%</span>
          <button type="button" className="btn-ghost px-2.5" aria-label="Aumentar zoom" onClick={() => zoomAt(STEP)}><Plus size={15} /></button>
          <button type="button" className="btn-ghost px-2.5" aria-label="Ajustar à tela" title="Ajustar à tela" onClick={reset}><Maximize2 size={15} /></button>
        </div>
        <a href={src} target="_blank" rel="noopener" className="btn-ghost px-3 text-xs"><ExternalLink size={14} /> Abrir em nova aba</a>
      </div>
      <div
        ref={box}
        className="relative h-[60vh] overflow-hidden rounded-xl border border-line bg-zinc-200 touch-none select-none"
        style={{ cursor: drag.current ? "grabbing" : "grab" }}
        {...(isPdf ? {} : handlers)}
      >
        <div
          className="absolute left-1/2 top-1/2 origin-center"
          style={{ transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px)) scale(${scale})`, transition: drag.current || gesture.current ? "none" : "transform 80ms" }}
        >
          {isPdf ? (
            <iframe title="Comprovante" src={`${src}#toolbar=0&navpanes=0&view=FitH`} className="pointer-events-none h-[150vh] w-[min(90vw,720px)] bg-white" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="Comprovante enviado" src={src} draggable={false} className="max-h-[60vh] max-w-[min(90vw,720px)] object-contain" />
          )}
        </div>
        {isPdf && <div className="absolute inset-0" aria-hidden {...handlers} />}
      </div>
      <p className="mt-1.5 text-xs text-muted">Arraste para navegar; roda do mouse ou pinça para o zoom.</p>
    </div>
  );
}
