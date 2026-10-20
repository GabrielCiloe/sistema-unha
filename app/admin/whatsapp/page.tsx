"use client";

import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { PageTitle } from "@/components/admin-shell";
import { MessagesPanel } from "@/components/messages-panel";
import { toast } from "@/components/toast";
import { maskPhone } from "@/lib/templates";
import { ConnectionPanel } from "@/components/whatsapp-connection";
import { api, useApi } from "@/lib/client";
import { WhatsAppSkeleton } from "@/components/skeleton";

type Session = { id?: string; sessionId?: string; name?: string; status?: string };
type Resp = {
  configured: boolean;
  sessions: Session[];
  selected: string;
  error?: string;
};

const sid = (s: Session) => s.sessionId ?? s.id ?? s.name ?? "";

export default function WhatsApp() {
  const { data, loading, reload } = useApi<Resp>("/api/admin/whatsapp");
  const [qr, setQr] = useState<{ id: string; value: string | null } | null>(null);
  const [testPhone, setTestPhone] = useState("");

  async function run(fn: () => Promise<unknown>, ok?: string) {
    try {
      await fn();
      if (ok) toast(ok);
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Erro", false);
    }
  }

  async function showQr(id: string) {
    await run(async () => {
      const r = await api<{ qr: string | null }>(`/api/admin/whatsapp?qr=${encodeURIComponent(id)}`);
      setQr({ id, value: r.qr });
    });
  }

  if (loading) return <WhatsAppSkeleton />;
  if (!data) return null;

  return (
    <>
      <PageTitle title="WhatsApp" />
      {!data.configured && (
        <div className="card mb-6 border-amber-500/40 text-sm">
          <p className="font-medium text-amber-300">WA-AKG não configurado</p>
          <p className="mt-1 text-muted">
            Defina <code>WA_AKG_URL</code> e <code>WA_AKG_API_KEY</code> nas variáveis de ambiente (veja docs/INTEGRACOES.md).
            O app funciona sem WhatsApp, mas confirmações e lembretes não serão enviados.
          </p>
        </div>
      )}
      {data.error && <p role="alert" className="mb-4 text-sm text-red-300">WA-AKG: {data.error}</p>}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* Coluna grande: conversas */}
        <div className="min-w-0 xl:order-1">
          <MessagesPanel />
        </div>

        {/* Coluna menor: conexão e sessões */}
        <aside className="min-w-0 space-y-6 xl:order-2">
      <ConnectionPanel onChange={reload} />

      {data.configured && (
        <section className="card">
          <h2 className="mb-3 font-semibold">Sessões (avançado)</h2>
          <form
            className="mb-4 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              const name = String(new FormData(e.currentTarget).get("name") ?? "");
              run(() => api("/api/admin/whatsapp", { method: "POST", body: { action: "create", name } }), "Sessão criada. Escaneie o QR para conectar.");
              e.currentTarget.reset();
            }}
          >
            <label className="sr-only" htmlFor="wa-name">Nome da nova sessão</label>
            <input id="wa-name" name="name" required placeholder="nova-sessao" className="input w-full" />
            <button className="btn-ghost w-full">Criar sessão</button>
          </form>
          {data.sessions.length === 0 ? (
            <p className="text-sm text-muted">Nenhuma sessão ainda.</p>
          ) : (
            <ul className="space-y-2">
              {data.sessions.map((s) => {
                const id = sid(s);
                return (
                  <li key={id} className="space-y-3 rounded-xl border border-line p-3 text-sm">
                    <span className="block">{id} <span className="badge ml-2 bg-surface-2 text-muted">{s.status ?? "?"}</span></span>
                    <span className="grid gap-2">
                      {s.status === "STOPPED" && (
                        <button className="btn-ghost w-full" onClick={() => run(() => api("/api/admin/whatsapp", { method: "POST", body: { action: "start", sessionId: id } }), "Sessão iniciada. Clique em QR Code em alguns segundos.")}>Iniciar</button>
                      )}
                      <button className="btn-ghost w-full" onClick={() => showQr(id)}>QR Code</button>
                      <button
                        className={`w-full ${data.selected === id ? "btn-primary" : "btn-ghost"}`}
                        onClick={() => run(() => api("/api/admin/whatsapp", { method: "POST", body: { action: "select", sessionId: id } }))}
                      >
                        {data.selected === id ? "Em uso" : "Usar esta"}
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {qr && (
            <div className="mt-4 rounded-xl bg-white p-4 text-center text-black">
              {qr.value ? <QRCodeSVG value={qr.value} size={220} className="mx-auto" /> : <p className="text-sm">QR indisponível — a sessão já está conectada ou ainda iniciando.</p>}
              <p className="mt-2 text-xs">WhatsApp → Aparelhos conectados → Conectar um aparelho</p>
            </div>
          )}
          <form
            className="mt-5 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => api("/api/admin/whatsapp", { method: "POST", body: { action: "test", phone: testPhone } }), "Mensagem de teste enviada.");
            }}
          >
            <div>
              <label className="label" htmlFor="wa-test">Enviar mensagem de teste para</label>
              <input id="wa-test" className="input" placeholder="(11) 91234-5678" inputMode="tel" value={testPhone} onChange={(e) => setTestPhone(maskPhone(e.target.value))} />
            </div>
            <button className="btn-ghost w-full" disabled={!data.selected}>Enviar teste</button>
          </form>
        </section>
      )}

        </aside>
      </div>
    </>
  );
}
