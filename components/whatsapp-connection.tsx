"use client";

import { LogOut, Power, RefreshCw, Smartphone } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useState } from "react";
import { Switch } from "@/components/switch";
import { api } from "@/lib/client";
import { InlineSkeleton, Skeleton } from "@/components/skeleton";

export type WaStatus = { configured: boolean; selected: string; status: string | null; error?: string };

// Estado da sessão em uso, atualizado periodicamente (mais rápido enquanto aguarda o QR).
export function useWaStatus(pollMs = 8000) {
  const [state, setState] = useState<WaStatus | null>(null);
  const reload = useCallback(async () => {
    try {
      setState(await api<WaStatus>("/api/admin/whatsapp?status=1"));
    } catch {
      /* mantém o último estado */
    }
  }, []);
  useEffect(() => {
    reload();
    const t = setInterval(reload, state?.status === "SCAN_QR" ? 3000 : pollMs);
    return () => clearInterval(t);
  }, [reload, pollMs, state?.status]);
  return { state, reload };
}

const LABEL: Record<string, [string, string]> = {
  CONNECTED: ["Conectado", "bg-emerald-500/15 text-emerald-300"],
  SCAN_QR: ["Aguardando QR", "bg-amber-500/15 text-amber-300"],
  STOPPED: ["Parado", "bg-zinc-500/20 text-zinc-300"],
  DISCONNECTED: ["Desconectado", "bg-red-500/15 text-red-300"],
  LOGGED_OUT: ["Desconectado", "bg-red-500/15 text-red-300"],
};
export const waLabel = (s: string | null) => LABEL[s ?? ""] ?? [s ?? "Sem sessão", "bg-zinc-500/20 text-zinc-300"];

export function ConnectionPanel({ onChange }: { onChange?: () => void }) {
  const { state, reload } = useWaStatus(5000);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receiving, setReceiving] = useState<boolean | null>(null);

  const status = state?.status ?? null;
  const session = state?.selected ?? "";

  // O webhook de mensagens recebidas está ativo? (só faz sentido com o WhatsApp conectado)
  useEffect(() => {
    if (status !== "CONNECTED") return;
    api<{ receiving: boolean }>("/api/admin/whatsapp?receiving=1").then((r) => setReceiving(r.receiving)).catch(() => setReceiving(null));
  }, [status, session]);

  // Enquanto aguarda o pareamento, busca o QR (que o WhatsApp renova a cada ~20 s).
  useEffect(() => {
    if (status !== "SCAN_QR" || !session) {
      setQr(null);
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const r = await api<{ qr: string | null }>(`/api/admin/whatsapp?qr=${encodeURIComponent(session)}`);
        if (alive) setQr(r.qr);
      } catch {
        /* tenta de novo no próximo ciclo */
      }
    };
    load();
    const t = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [status, session]);

  async function run(body: object) {
    setBusy(true);
    setError("");
    try {
      await api("/api/admin/whatsapp", { method: "POST", body });
      await reload();
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    } finally {
      setBusy(false);
    }
  }

  if (!state) return <section className="card"><InlineSkeleton rows={3} /></section>;
  if (!state.configured) return null;

  const [text, cls] = waLabel(status);
  async function toggleReceiving(enabled: boolean) {
    setBusy(true);
    setError("");
    try {
      await api("/api/admin/whatsapp", { method: "POST", body: { action: "webhook", sessionId: session, enabled } });
      setReceiving(enabled);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    } finally {
      setBusy(false);
    }
  }
  const control = (command: string) => run({ action: "control", sessionId: session, command });

  return (
    <section className="card" aria-labelledby="wa-conn">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="wa-conn" className="flex items-center gap-2 font-semibold"><Smartphone size={18} /> Conexão do WhatsApp</h2>
        <span className={`badge ${cls}`}>{status === null && session ? "Sessão não encontrada" : text}</span>
      </div>
      {state.error && <p role="alert" className="mb-3 text-sm text-red-300">WA-AKG: {state.error}</p>}
      {error && <p role="alert" className="mb-3 text-sm text-red-300">{error}</p>}

      {status === "CONNECTED" && (
        <div className="space-y-4">
          <p className="text-sm text-muted">O número está pareado. Confirmações, lembretes e conversas usam esta conexão.</p>
          <div className="flex items-center justify-between gap-4 rounded-xl border border-line bg-background p-3.5">
            <div className="min-w-0">
              <p className="text-sm font-medium">Receber mensagens das clientes</p>
              <p className="text-xs text-muted">{receiving ? "Ligado: as respostas aparecem em Mensagens." : "Desligado: só as mensagens enviadas pelo sistema aparecem."}</p>
            </div>
            <Switch label="Receber mensagens das clientes" checked={Boolean(receiving)} disabled={busy || receiving === null} onChange={toggleReceiving} />
          </div>
          <div className="grid gap-2">
            <button className="btn-ghost w-full" disabled={busy} onClick={() => control("restart")}><RefreshCw size={15} /> Reiniciar conexão</button>
            <button
              className="btn-danger w-full"
              disabled={busy}
              onClick={() => confirm("Desconectar o WhatsApp deste aparelho? Será preciso escanear um novo QR para voltar.") && control("logout")}
            >
              <LogOut size={15} /> Desconectar aparelho
            </button>
          </div>
        </div>
      )}

      {status === "SCAN_QR" && (
        <div className="space-y-4">
          <div className="rounded-xl bg-white p-3">
            {qr ? <QRCodeSVG value={qr} size={216} className="mx-auto" /> : <Skeleton className="mx-auto size-[216px] bg-black/10" />}
          </div>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted">
            <li>No celular, abra o WhatsApp.</li>
            <li>Toque em <strong className="text-ink">Aparelhos conectados → Conectar um aparelho</strong>.</li>
            <li>Aponte a câmera para este QR. Ele se renova sozinho.</li>
            <li>Use o número do estúdio.</li>
          </ol>
        </div>
      )}

      {(status === "STOPPED" || status === "DISCONNECTED" || status === "LOGGED_OUT") && (
        <div className="space-y-3">
          <p className="text-sm text-muted">O WhatsApp não está conectado. Clique para gerar um QR e parear quando quiser.</p>
          <button className="btn-primary w-full" disabled={busy} onClick={() => run({ action: "connect" })}><Power size={15} /> Conectar WhatsApp</button>
        </div>
      )}

      {(status === null || !session) && (
        <div className="space-y-3">
          <p className="text-sm text-muted">Nenhuma sessão em uso. Crie a conexão e escaneie o QR em seguida.</p>
          <button className="btn-primary w-full" disabled={busy} onClick={() => run({ action: "connect" })}><Power size={15} /> Conectar WhatsApp</button>
        </div>
      )}
    </section>
  );
}
