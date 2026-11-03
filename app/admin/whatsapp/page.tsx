"use client";

import { PageTitle } from "@/components/admin-shell";
import { MessagesPanel } from "@/components/messages-panel";
import { ConnectionPanel } from "@/components/whatsapp-connection";
import { useApi } from "@/lib/client";
import { WhatsAppSkeleton } from "@/components/skeleton";

type Resp = { configured: boolean; error?: string };

export default function WhatsApp() {
  const { data, loading, reload } = useApi<Resp>("/api/admin/whatsapp");

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

        {/* Coluna menor: conexão (conectar, QR, receber mensagens, reiniciar, desconectar) */}
        <aside className="min-w-0 xl:order-2">
          <ConnectionPanel onChange={reload} />
        </aside>
      </div>
    </>
  );
}
