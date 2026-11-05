"use client";

import { ExternalLink, LocateFixed, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { mapsUrl } from "@/lib/templates";

// Mapa para marcar o estúdio (Configurações). Usa Leaflet + OpenStreetMap pelo CDN: sem chave, sem custo.
// Toque no mapa coloca o pino; o pino pode ser arrastado; "Localizar endereço" procura o endereço digitado.
const LEAFLET = "https://unpkg.com/leaflet@1.9.4/dist";
const BRAZIL: [number, number] = [-14.235, -51.925];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type L = any;
declare global {
  interface Window {
    L?: L;
    __leaflet?: Promise<L>;
  }
}

function loadLeaflet(): Promise<L> {
  if (window.L) return Promise.resolve(window.L);
  if (!window.__leaflet) {
    window.__leaflet = new Promise((resolve, reject) => {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = `${LEAFLET}/leaflet.css`;
      document.head.appendChild(css);
      const js = document.createElement("script");
      js.src = `${LEAFLET}/leaflet.js`;
      js.onload = () => resolve(window.L);
      js.onerror = () => reject(new Error("Não foi possível carregar o mapa."));
      document.head.appendChild(js);
    });
  }
  return window.__leaflet;
}

export function LocationPicker({ lat, lng, address, onChange }: { lat: number | null; lng: number | null; address: string; onChange: (lat: number | null, lng: number | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L>(null);
  const marker = useRef<L>(null);
  const change = useRef(onChange);
  change.current = onChange;
  const [ready, setReady] = useState(false);
  const [finding, setFinding] = useState(false);
  const [city, setCity] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let alive = true;
    loadLeaflet()
      .then((L) => {
        if (!alive || !box.current || map.current) return;
        const has = lat != null && lng != null;
        const m = L.map(box.current).setView(has ? [lat, lng] : BRAZIL, has ? 16 : 4);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(m);
        m.on("click", (e: { latlng: { lat: number; lng: number } }) => change.current(e.latlng.lat, e.latlng.lng));
        map.current = m;
        setReady(true);
      })
      .catch((e: Error) => setMsg(e.message));
    return () => {
      alive = false;
      map.current?.remove();
      map.current = null;
      marker.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pino acompanha o valor salvo.
  useEffect(() => {
    const L = window.L;
    const m = map.current;
    if (!ready || !L || !m) return;
    if (lat == null || lng == null) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    if (!marker.current) {
      marker.current = L.marker([lat, lng], { draggable: true }).addTo(m);
      marker.current.on("dragend", () => {
        const p = marker.current.getLatLng();
        change.current(p.lat, p.lng);
      });
    } else marker.current.setLatLng([lat, lng]);
  }, [lat, lng, ready]);

  async function locate() {
    if (!address.trim()) return setMsg("Preencha o endereço acima para localizar.");
    setFinding(true);
    setMsg("");
    try {
      const r = await api<{ found: boolean; lat?: number; lng?: number; label?: string }>(`/api/admin/geocode?${new URLSearchParams({ address, city })}`);
      if (!r.found || r.lat == null || r.lng == null) return setMsg("Endereço não encontrado. Confira a cidade e o nome da rua, ou toque no mapa para marcar o ponto exato.");
      onChange(r.lat, r.lng);
      map.current?.setView([r.lat, r.lng], 17);
      setMsg(`Encontrado: ${r.label ?? ""}. Confira o pino e arraste se precisar ajustar.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Não foi possível buscar o endereço agora. Toque no mapa para marcar.");
    } finally {
      setFinding(false);
    }
  }

  const link = mapsUrl({ latitude: lat, longitude: lng, mapsAddress: address });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <label className="label" htmlFor="geo-city">Cidade e estado (para a busca)</label>
          <input id="geo-city" className="input" placeholder="Ex.: Recife - PE" value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        <button type="button" className="btn-ghost" disabled={finding} onClick={locate}><LocateFixed size={16} /> {finding ? "Procurando…" : "Localizar endereço"}</button>
        {link && <button type="button" className="btn-ghost" onClick={() => onChange(null, null)}><Trash2 size={16} /> Remover pino</button>}
      </div>
      {/* isolate: as camadas do Leaflet não passam por cima do cabeçalho e da barra de botões. */}
      <div ref={box} className="isolate z-0 h-72 w-full overflow-hidden rounded-xl border border-line bg-surface-2" aria-label="Mapa para marcar o estúdio" />
      {msg && <p className="text-xs text-muted">{msg}</p>}
      {link ? (
        <>
          <a href={link} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 text-sm text-brand-soft underline"><ExternalLink size={14} /> Abrir no Google Maps (é este link que a cliente recebe)</a>
          {lat == null && <p className="text-xs text-muted">Sem pino, o link usa só o endereço digitado. Marque o pino para a cliente chegar no ponto exato.</p>}
        </>
      ) : (
        <p className="text-xs text-muted">Sem endereço nem pino: as mensagens vão sem o link do mapa.</p>
      )}
    </div>
  );
}
