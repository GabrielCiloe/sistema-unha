"use client";

import { Clock, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { PageTitle } from "@/components/admin-shell";
import { Modal } from "@/components/modal";
import { api, useApi } from "@/lib/client";
import { brl } from "@/lib/templates";
import { CardGridSkeleton } from "@/components/skeleton";

type Service = { id: string; name: string; description: string; durationMin: number; priceCents: number; active: boolean };
type Draft = { id?: string; name: string; description: string; durationMin: string; price: string; active: boolean };

const empty: Draft = { name: "", description: "", durationMin: "60", price: "", active: true };
const toDraft = (s: Service): Draft => ({
  id: s.id,
  name: s.name,
  description: s.description,
  durationMin: String(s.durationMin),
  price: (s.priceCents / 100).toFixed(2).replace(".", ","),
  active: s.active,
});

export default function Services() {
  const { data, loading, reload } = useApi<{ services: Service[] }>("/api/admin/services");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const close = () => {
    setDraft(null);
    setError("");
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const priceCents = Math.round(parseFloat(draft.price.replace(/\./g, "").replace(",", ".")) * 100);
    if (!Number.isFinite(priceCents)) return setError("Informe um preço válido, por exemplo 45,00.");
    const body = { name: draft.name, description: draft.description, durationMin: Number(draft.durationMin), priceCents, active: draft.active };
    setSaving(true);
    try {
      setError("");
      if (draft.id) await api(`/api/admin/services/${draft.id}`, { method: "PUT", body });
      else await api("/api/admin/services", { method: "POST", body });
      close();
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(s: Service) {
    await api(`/api/admin/services/${s.id}`, { method: "PUT", body: { name: s.name, description: s.description, durationMin: s.durationMin, priceCents: s.priceCents, active: !s.active } });
    reload();
  }

  async function remove(s: Service) {
    if (!confirm(`Excluir "${s.name}"? Agendamentos antigos continuam com o valor histórico.`)) return;
    await api(`/api/admin/services/${s.id}`, { method: "DELETE" });
    reload();
  }

  return (
    <>
      <PageTitle title="Serviços">
        <button className="btn-primary" onClick={() => setDraft(empty)}><Plus size={16} /> Novo serviço</button>
      </PageTitle>

      {loading ? (
        <CardGridSkeleton />
      ) : !data?.services.length ? (
        <div className="card text-center">
          <p className="text-sm text-muted">Cadastre ao menos um serviço para liberar a agenda pública.</p>
          <button className="btn-primary mt-4" onClick={() => setDraft(empty)}><Plus size={16} /> Criar primeiro serviço</button>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.services.map((s) => (
            <li key={s.id} className={`card flex flex-col ${s.active ? "" : "opacity-60"}`}>
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-semibold leading-snug">{s.name}</h2>
                <span className={`badge shrink-0 ${s.active ? "bg-emerald-500/15 text-emerald-300" : "bg-zinc-500/20 text-zinc-300"}`}>{s.active ? "Ativo" : "Inativo"}</span>
              </div>
              <p className="mt-1 line-clamp-2 min-h-10 text-sm text-muted">{s.description || "Sem descrição."}</p>
              <div className="mt-4 flex items-end justify-between">
                <p className="text-2xl font-semibold">{brl(s.priceCents)}</p>
                <p className="flex items-center gap-1 text-sm text-muted"><Clock size={14} /> {s.durationMin} min</p>
              </div>
              <div className="mt-5 flex items-center gap-2 border-t border-line pt-4">
                <button className="btn-ghost flex-1" onClick={() => toggle(s)}>{s.active ? "Desativar" : "Ativar"}</button>
                <button aria-label={`Editar ${s.name}`} className="btn-ghost" onClick={() => setDraft(toDraft(s))}><Pencil size={15} /></button>
                <button aria-label={`Excluir ${s.name}`} className="btn-danger" onClick={() => remove(s)}><Trash2 size={15} /></button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {draft && (
        <Modal title={draft.id ? "Editar serviço" : "Novo serviço"} onClose={close}>
          <form onSubmit={save} className="space-y-4">
            <div>
              <label className="label" htmlFor="s-name">Nome</label>
              <input id="s-name" data-autofocus className="input" required minLength={2} maxLength={80} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label" htmlFor="s-price">Preço (R$)</label>
                <input id="s-price" className="input" required inputMode="decimal" placeholder="45,00" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="s-dur">Duração (min)</label>
                <input id="s-dur" className="input" required type="number" min={5} max={600} step={5} value={draft.durationMin} onChange={(e) => setDraft({ ...draft, durationMin: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="s-desc">Descrição</label>
              <textarea id="s-desc" rows={3} maxLength={300} className="input" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
              Disponível para agendamento
            </label>
            {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
            <div className="flex gap-2 pt-1">
              <button className="btn-primary flex-1" disabled={saving}>{saving ? "Salvando…" : "Salvar"}</button>
              <button type="button" className="btn-ghost" onClick={close}>Cancelar</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
