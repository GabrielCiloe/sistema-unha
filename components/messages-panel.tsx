"use client";

import { ArrowLeft, Pencil, Send, UserPlus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "@/components/modal";
import { toast } from "@/components/toast";
import { api } from "@/lib/client";
import { fmtDateTime, formatPhone, maskPhone } from "@/lib/templates";
import { ListSkeleton } from "@/components/skeleton";

type Conversation = { phone: string; name: string | null; lastBody: string; lastDirection: "IN" | "OUT"; lastAt: string };
type Message = { id: string; direction: "IN" | "OUT"; body: string; status: string; error: string | null; createdAt: string };

const label = (c: { phone: string; name: string | null }) => c.name ?? formatPhone(c.phone);

// Duas colunas (lista + conversa) quando o contêiner é largo; uma por vez em espaço estreito.
export function MessagesPanel() {
  const [list, setList] = useState<Conversation[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [thread, setThread] = useState<{ name: string | null; notes?: string; messages: Message[] } | null>(null);
  const [editing, setEditing] = useState<{ name: string; notes: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [text, setText] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const loadList = useCallback(async () => {
    try {
      setList((await api<{ conversations: Conversation[] }>("/api/admin/messages")).conversations);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    }
  }, []);

  const loadThread = useCallback(async (phone: string) => {
    try {
      setThread(await api(`/api/admin/messages?phone=${phone}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    }
  }, []);

  // Link direto: /admin/whatsapp?phone=5511...
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("phone")?.replace(/\D/g, "");
    if (p) setActive(p);
  }, []);

  // Atualização periódica (novas mensagens chegam pelo webhook do WA-AKG).
  useEffect(() => {
    loadList();
    const t = setInterval(() => {
      loadList();
      if (active) loadThread(active);
    }, 5000);
    return () => clearInterval(t);
  }, [active, loadList, loadThread]);

  useEffect(() => {
    if (active) loadThread(active);
  }, [active, loadThread]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [thread?.messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!active || !text.trim()) return;
    setSending(true);
    setError("");
    try {
      await api("/api/admin/messages", { method: "POST", body: { phone: active, text } });
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally {
      await loadThread(active);
      loadList();
      setSending(false);
    }
  }

  async function saveCustomer(e: React.FormEvent) {
    e.preventDefault();
    if (!active || !editing) return;
    setSaving(true);
    try {
      await api("/api/admin/customers", { method: "POST", body: { phone: active, name: editing.name, notes: editing.notes } });
      toast(thread?.name ? "Cliente atualizada com sucesso!" : "Cliente cadastrada! Ela já aparece em Clientes.");
      setEditing(null);
      await loadThread(active);
      loadList();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Erro", false);
    } finally {
      setSaving(false);
    }
  }

  function startNew(e: React.FormEvent) {
    e.preventDefault();
    const digits = newPhone.replace(/\D/g, "");
    if (digits.length < 10) return setError("Informe o telefone com DDD.");
    setError("");
    setActive(digits.length <= 11 ? `55${digits}` : digits);
    setNewPhone("");
  }

  return (
    <div className="@container">
      {error && <p role="alert" className="mb-3 text-sm text-red-300">{error}</p>}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 @2xl:grid-cols-[300px_minmax(0,1fr)]">
        <section className={`card min-w-0 p-0 ${active ? "hidden @2xl:block" : ""}`}>
          <form onSubmit={startNew} className="flex gap-2 border-b border-line p-3">
            <label className="sr-only" htmlFor="new-phone">Nova conversa</label>
            <input id="new-phone" className="input min-w-0" placeholder="Nova conversa: (11) 91234-5678" inputMode="tel" value={newPhone} onChange={(e) => setNewPhone(maskPhone(e.target.value))} />
            <button className="btn-ghost">Abrir</button>
          </form>
          <ul className="max-h-[65vh] divide-y divide-line overflow-y-auto">
            {list === null && <li><ListSkeleton /></li>}
            {list?.length === 0 && <li className="p-4 text-sm text-muted">Nenhuma conversa ainda. Elas aparecem ao enviar confirmações ou receber mensagens.</li>}
            {list?.map((c) => (
              <li key={c.phone}>
                <button onClick={() => setActive(c.phone)} aria-current={active === c.phone} className={`w-full p-3.5 text-left transition hover:bg-surface-2 ${active === c.phone ? "bg-brand/15" : ""}`}>
                  <span className="flex justify-between gap-2">
                    <span className="truncate font-medium">{label(c)}</span>
                    <span className="shrink-0 text-xs text-muted">{fmtDateTime(c.lastAt)}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-sm text-muted">{c.lastDirection === "OUT" ? "Você: " : ""}{c.lastBody}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className={`card flex min-h-[60vh] min-w-0 flex-col p-0 ${active ? "" : "hidden @2xl:flex"}`}>
          {!active ? (
            <p className="m-auto text-sm text-muted">Selecione uma conversa.</p>
          ) : (
            <>
              <header className="flex items-center gap-3 border-b border-line p-3.5">
                <button className="@2xl:hidden" aria-label="Voltar" onClick={() => setActive(null)}><ArrowLeft size={18} /></button>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{thread?.name ?? formatPhone(active)}</p>
                  {thread?.name && <p className="text-xs text-muted">{formatPhone(active)}</p>}
                </div>
                {thread && (
                  <button className="btn-ghost shrink-0" onClick={() => setEditing({ name: thread.name ?? "", notes: thread.notes ?? "" })}>
                    {thread.name ? <><Pencil size={15} /> Editar cliente</> : <><UserPlus size={15} /> Tornar cliente</>}
                  </button>
                )}
              </header>
              <ul className="flex-1 space-y-2 overflow-y-auto p-4" style={{ maxHeight: "55vh" }}>
                {thread?.messages.length === 0 && <li className="text-sm text-muted">Sem mensagens ainda. Escreva abaixo para começar.</li>}
                {thread?.messages.map((m) => (
                  <li key={m.id} className={`flex ${m.direction === "OUT" ? "justify-end" : ""}`}>
                    <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${m.direction === "OUT" ? "bg-brand/30" : "bg-surface-2"}`}>
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      <p className="mt-1 text-[11px] text-muted">
                        {fmtDateTime(m.createdAt)}
                        {m.direction === "OUT" && m.status !== "SENT" && <span className="text-red-300"> · {m.status === "FAILED" ? "não enviada" : m.status === "SKIPPED" ? "sem sessão" : m.status}</span>}
                      </p>
                    </div>
                  </li>
                ))}
                <div ref={bottom} />
              </ul>
              <form onSubmit={send} className="flex gap-2 border-t border-line p-3">
                <label className="sr-only" htmlFor="msg">Mensagem</label>
                <input id="msg" className="input min-w-0" placeholder="Escreva uma mensagem" maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
                <button className="btn-primary" disabled={sending || !text.trim()} aria-label="Enviar"><Send size={16} /></button>
              </form>
            </>
          )}
        </section>
      </div>

      {editing && active && (
        <Modal title={thread?.name ? "Editar cliente" : "Tornar cliente"} onClose={() => setEditing(null)}>
          <form onSubmit={saveCustomer} className="space-y-4">
            <div>
              <label className="label" htmlFor="cl-phone">WhatsApp (identificador)</label>
              <input id="cl-phone" className="input" value={formatPhone(active)} readOnly disabled />
            </div>
            <div>
              <label className="label" htmlFor="cl-name">Nome</label>
              <input id="cl-name" data-autofocus className="input" required minLength={2} maxLength={80} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="cl-notes">Observações (opcional)</label>
              <textarea id="cl-notes" rows={3} maxLength={500} className="input" value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn-ghost flex-1" onClick={() => setEditing(null)}>Cancelar</button>
              <button className="btn-primary flex-1" disabled={saving || editing.name.trim().length < 2}>{saving ? "Salvando…" : "Salvar cliente"}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
