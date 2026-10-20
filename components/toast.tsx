"use client";

import { AlertCircle, CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";

type Item = { id: number; ok: boolean; text: string };
type Listener = (i: Item) => void;

const listeners = new Set<Listener>();
let seq = 0;

// Avisa de qualquer lugar: toast("Salvo!") ou toast("Erro...", false). Exige <Toaster /> montado (admin-shell).
export function toast(text: string, ok = true) {
  const item = { id: ++seq, ok, text };
  listeners.forEach((l) => l(item));
}

export function Toaster() {
  const [item, setItem] = useState<Item | null>(null);

  useEffect(() => {
    const l: Listener = (i) => setItem(i);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);

  useEffect(() => {
    if (!item) return;
    const t = setTimeout(() => setItem(null), item.ok ? 3000 : 5000);
    return () => clearTimeout(t);
  }, [item]);

  if (!item) return null;
  const Icon = item.ok ? CheckCircle2 : AlertCircle;
  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4 backdrop-blur-md"
      onMouseDown={() => setItem(null)}
    >
      <div
        key={item.id}
        role="status"
        className="flex max-w-md items-center gap-4 rounded-xl bg-zinc-900 px-8 py-6 text-lg text-white shadow-2xl ring-1 ring-white/10"
      >
        <Icon size={36} strokeWidth={1.75} className={item.ok ? "shrink-0 text-white" : "shrink-0 text-red-400"} aria-hidden />
        <span>{item.text}</span>
      </div>
    </div>
  );
}
