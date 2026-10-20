"use client";

import { useEffect, useState } from "react";
import { PageTitle } from "@/components/admin-shell";
import { Switch } from "@/components/switch";
import { toast } from "@/components/toast";
import { DEFAULT_RETURN_TEMPLATE } from "@/lib/defaults";
import { maskPhone } from "@/lib/templates";
import { api, useApi } from "@/lib/client";
import { FormSkeleton } from "@/components/skeleton";

type Biz = {
  name: string; phone: string; address: string; pixKey: string; pixName: string; pixCity: string;
  depositPercent: number; openMinutes: number; closeMinutes: number;
  workDays: number[]; slotStepMinutes: number; bufferMinutes: number; reminderHours: number; waSessionId: string;
  confirmationTemplate: string; reminderTemplate: string;
  returnEnabled: boolean; returnAfterDays: number; returnWindowStart: number; returnWindowEnd: number; returnTemplate: string;
};

const DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const fromTime = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

export default function Settings() {
  const { data, loading } = useApi<{ business: Biz; env: { whatsapp: boolean } }>("/api/admin/business");
  const [b, setB] = useState<Biz | null>(null);

  useEffect(() => {
    if (data) setB({ ...data.business, returnTemplate: data.business.returnTemplate || DEFAULT_RETURN_TEMPLATE });
  }, [data]);

  if (loading || !b || !data) return <FormSkeleton />;
  const set = <K extends keyof Biz>(k: K, v: Biz[K]) => setB({ ...b, [k]: v });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!b) return;
    try {
      // O schema do servidor descarta campos extras (id, updatedAt).
      await api("/api/admin/business", { method: "PUT", body: b });
      toast("Configurações salvas com sucesso!");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Erro", false);
    }
  }

  return (
    <>
      <PageTitle title="Configurações" />
      <form onSubmit={save} className="space-y-6">
        <section className="card grid gap-4 sm:grid-cols-2">
          <h2 className="font-semibold sm:col-span-2">Estúdio</h2>
          <Field id="name" label="Nome" value={b.name} onChange={(v) => set("name", v)} />
          <Field id="phone" label="Telefone" value={maskPhone(b.phone)} onChange={(v) => set("phone", maskPhone(v))} />
          <div className="sm:col-span-2"><Field id="address" label="Endereço" value={b.address} onChange={(v) => set("address", v)} /></div>
        </section>

        <section className="card grid gap-4 sm:grid-cols-2">
          <h2 className="font-semibold sm:col-span-2">Horários</h2>
          <div>
            <label className="label" htmlFor="open">Abertura</label>
            <input id="open" type="time" className="input" value={toTime(b.openMinutes)} onChange={(e) => set("openMinutes", fromTime(e.target.value))} />
          </div>
          <div>
            <label className="label" htmlFor="close">Fechamento</label>
            <input id="close" type="time" className="input" value={toTime(b.closeMinutes)} onChange={(e) => set("closeMinutes", fromTime(e.target.value))} />
          </div>
          <div>
            <label className="label" htmlFor="step">Intervalo entre as opções de horário</label>
            <select id="step" className="input" value={b.slotStepMinutes} onChange={(e) => set("slotStepMinutes", Number(e.target.value))}>
              {[10, 15, 20, 30, 45, 60].map((n) => <option key={n} value={n}>{n} min</option>)}
            </select>
            <p className="mt-1 text-xs text-muted">De quanto em quanto tempo a cliente vê um horário livre. Os horários começam sempre logo que o atendimento anterior termina, sem “buracos”.</p>
          </div>
          <div>
            <label className="label" htmlFor="buffer">Pausa entre atendimentos (min)</label>
            <input id="buffer" type="number" min={0} max={120} step={5} className="input" value={b.bufferMinutes} onChange={(e) => set("bufferMinutes", Number(e.target.value))} />
            <p className="mt-1 text-xs text-muted">Tempo reservado para limpar/preparar depois de cada cliente. Use 0 para encaixar um atendimento logo após o outro.</p>
          </div>
          <fieldset>
            <legend className="label">Dias de atendimento</legend>
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map((d, i) => (
                <label key={d} className={`badge cursor-pointer border ${b.workDays.includes(i) ? "border-brand-soft bg-brand/20 text-brand-soft" : "border-line text-muted"}`}>
                  <input type="checkbox" className="sr-only" checked={b.workDays.includes(i)} onChange={() => set("workDays", b.workDays.includes(i) ? b.workDays.filter((x) => x !== i) : [...b.workDays, i].sort())} />
                  {d}
                </label>
              ))}
            </div>
          </fieldset>
        </section>

        <section className="card grid gap-4 sm:grid-cols-2">
          <h2 className="font-semibold sm:col-span-2">Pagamento do sinal</h2>
          <div>
            <label className="label" htmlFor="dep">Sinal (% do total)</label>
            <input id="dep" type="number" min={10} max={100} className="input" value={b.depositPercent} onChange={(e) => set("depositPercent", Number(e.target.value))} />
          </div>
          <Field id="pixKey" label="Chave Pix" value={b.pixKey} onChange={(v) => set("pixKey", v)} />
          <Field id="pixName" label="Nome do recebedor (como no banco)" value={b.pixName} onChange={(v) => set("pixName", v)} />
          <Field id="pixCity" label="Cidade do recebedor" value={b.pixCity} onChange={(v) => set("pixCity", v)} />
        </section>

        <section className="card grid gap-4">
          <h2 className="font-semibold">Mensagens do WhatsApp</h2>
          <p className="text-xs text-muted">Variáveis: {"{cliente} {negocio} {servico} {data} {hora}"}</p>
          <div>
            <label className="label" htmlFor="ct">Confirmação (enviada quando o sinal é aprovado)</label>
            <textarea id="ct" rows={3} className="input" value={b.confirmationTemplate} onChange={(e) => set("confirmationTemplate", e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="rt">Lembrete</label>
            <textarea id="rt" rows={3} className="input" value={b.reminderTemplate} onChange={(e) => set("reminderTemplate", e.target.value)} />
          </div>
          <div className="max-w-xs">
            <label className="label" htmlFor="rh">Enviar lembrete quantas horas antes</label>
            <input id="rh" type="number" min={1} max={72} className="input" value={b.reminderHours} onChange={(e) => set("reminderHours", Number(e.target.value))} />
          </div>
        </section>

        <section className="card grid gap-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-semibold">Convite para voltar</h2>
              <p className="text-xs text-muted">Convida a cliente a renovar depois de alguns dias do último atendimento.</p>
            </div>
            <Switch label="Enviar convites para voltar" checked={b.returnEnabled} onChange={(v) => set("returnEnabled", v)} />
          </div>
          <div className={`grid gap-4 ${b.returnEnabled ? "" : "pointer-events-none opacity-50"}`} aria-disabled={!b.returnEnabled}>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="label" htmlFor="rd">Enviar após quantos dias</label>
                <input id="rd" type="number" min={1} max={365} className="input" value={b.returnAfterDays} onChange={(e) => set("returnAfterDays", Number(e.target.value))} />
              </div>
              <div>
                <label className="label" htmlFor="rws">Enviar a partir das</label>
                <input id="rws" type="time" className="input" value={toTime(b.returnWindowStart)} onChange={(e) => set("returnWindowStart", fromTime(e.target.value))} />
              </div>
              <div>
                <label className="label" htmlFor="rwe">Enviar até as</label>
                <input id="rwe" type="time" className="input" value={toTime(b.returnWindowEnd)} onChange={(e) => set("returnWindowEnd", fromTime(e.target.value))} />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="rtt">Mensagem do convite</label>
              <textarea id="rtt" rows={8} className="input" value={b.returnTemplate} onChange={(e) => set("returnTemplate", e.target.value)} />
              <p className="mt-1 text-xs text-muted">
                Variáveis: {"{cliente} {negocio} {servico} {dias} {data}"} ({"{servico}"} e {"{dias}"} vêm do último atendimento). Para variar, escreva várias versões separadas por uma linha só com <code>---</code>: cada envio sorteia uma.
              </p>
            </div>
            <p className="text-xs text-muted">
              Cada cliente recebe um horário sorteado dentro dessa janela, com pausas aleatórias entre envios (no máximo 20 por dia). Só convidamos quem não tem novo agendamento. Quem responder SAIR não recebe mais convites.
            </p>
          </div>
        </section>

        <button className="btn-primary">Salvar configurações</button>
      </form>
    </>
  );
}

function Field({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <input id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
