"use client";

import { Copy, KeyRound, Pencil, Send, Trash2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Modal } from "@/components/modal";
import { toast } from "@/components/toast";
import { api, useApi } from "@/lib/client";
import { PASSWORD_HINT, passwordProblem } from "@/lib/validation";

type User = { id: string; name: string; email: string; createdAt: string; lastSessionAt: string | null };
type Dialog =
  | { kind: "create"; name: string; email: string }
  | { kind: "created"; user: User; password: string }
  | { kind: "edit"; user: User; name: string; email: string }
  | { kind: "reset"; user: User; link?: string; expiresAt?: string; whatsappSent?: boolean; sent?: boolean };

const fmtDate = (d: string) => new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
const fmtWhen = (d: string) => new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const msg = (e: unknown) => (e instanceof Error ? e.message : "Erro");

async function copy(text: string, ok: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(ok);
  } catch {
    toast("Não foi possível copiar. Selecione o texto e copie manualmente.", false);
  }
}

// Configurações → "Acesso e senha" (a própria conta) + usuários com acesso ao painel.
export function AccessSettings() {
  const { data, loading, error, reload } = useApi<{ users: User[]; currentUserId: string }>("/api/admin/users");
  const me = data?.users.find((u) => u.id === data.currentUserId);

  return (
    <>
      <section className="card grid gap-4" aria-labelledby="access-title">
        <div>
          <h2 id="access-title" className="flex items-center gap-2 font-semibold"><KeyRound size={16} aria-hidden /> Acesso e senha</h2>
          <p className="mt-1 text-xs text-muted">Seus dados de entrada no painel.</p>
        </div>
        {loading ? <p className="text-sm text-muted">Carregando…</p> : !me ? <p role="alert" className="text-sm text-red-300">{error || "Não foi possível carregar seus dados."}</p> : <OwnAccount key={me.id + me.name} me={me} onSaved={reload} />}
      </section>

      <UsersCard users={data?.users ?? []} currentUserId={data?.currentUserId ?? ""} loading={loading} reload={reload} />
    </>
  );
}

function OwnAccount({ me, onSaved }: { me: User; onSaved: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(me.name);
  const [savingName, setSavingName] = useState(false);
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwError, setPwError] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setSavingName(true);
    try {
      await api(`/api/admin/users/${me.id}`, { method: "PATCH", body: { name } });
      toast("Nome atualizado.");
      onSaved();
      router.refresh(); // o nome também aparece no menu
    } catch (err) {
      toast(msg(err), false);
    } finally {
      setSavingName(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    const problem = passwordProblem(pw.next);
    if (problem) return setPwError(problem);
    if (pw.next !== pw.confirm) return setPwError("A confirmação não confere com a nova senha.");
    setSavingPw(true);
    setPwError("");
    try {
      await api("/api/auth/change-password", { method: "POST", body: { currentPassword: pw.current, newPassword: pw.next } });
      setPw({ current: "", next: "", confirm: "" });
      toast("Senha alterada. Os outros aparelhos foram desconectados.");
      onSaved();
    } catch (err) {
      setPwError(msg(err));
    } finally {
      setSavingPw(false);
    }
  }

  return (
    <>
      <form onSubmit={saveName} className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="acc-email">E-mail de login</label>
          <input id="acc-email" className="input opacity-70" value={me.email} readOnly />
          <p className="mt-1 text-xs text-muted">Para trocar o e-mail, use Editar na lista de usuários abaixo.</p>
        </div>
        <div>
          <label className="label" htmlFor="acc-name">Nome</label>
          <div className="flex gap-2">
            <input id="acc-name" className="input" required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn-ghost shrink-0" disabled={savingName || name.trim() === me.name || name.trim().length < 2}>{savingName ? "Salvando…" : "Salvar nome"}</button>
          </div>
        </div>
      </form>

      <form onSubmit={changePassword} className="grid gap-4 border-t border-line pt-4 sm:grid-cols-3">
        <h3 className="font-medium sm:col-span-3">Trocar senha</h3>
        {/* Ajuda o gerenciador de senhas a associar a nova senha ao login certo. */}
        <input type="text" name="username" autoComplete="username" value={me.email} readOnly hidden />
        <div>
          <label className="label" htmlFor="pw-current">Senha atual</label>
          <input id="pw-current" type="password" autoComplete="current-password" className="input" required value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="pw-next">Nova senha</label>
          <input id="pw-next" type="password" autoComplete="new-password" className="input" required value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="pw-confirm">Confirmar nova senha</label>
          <input id="pw-confirm" type="password" autoComplete="new-password" className="input" required value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
        </div>
        <p className="text-xs text-muted sm:col-span-3">{PASSWORD_HINT} Ao trocar, os outros aparelhos conectados com este acesso são desconectados; este continua logado.</p>
        {pwError && <p role="alert" className="text-sm text-red-300 sm:col-span-3">{pwError}</p>}
        <div className="sm:col-span-3">
          <button className="btn-primary w-full sm:w-auto" disabled={savingPw}><KeyRound size={16} aria-hidden /> {savingPw ? "Trocando…" : "Trocar senha"}</button>
        </div>
      </form>
    </>
  );
}

function UsersCard({ users, currentUserId, loading, reload }: { users: User[]; currentUserId: string; loading: boolean; reload: () => void }) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const close = () => {
    setDialog(null);
    setError("");
  };

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(msg(err));
    } finally {
      setBusy(false);
    }
  }

  const create = (d: Extract<Dialog, { kind: "create" }>) =>
    run(async () => {
      const r = await api<{ user: User; password: string }>("/api/admin/users", { method: "POST", body: { name: d.name, email: d.email } });
      setDialog({ kind: "created", user: r.user, password: r.password });
      reload();
    });

  const edit = (d: Extract<Dialog, { kind: "edit" }>) =>
    run(async () => {
      await api(`/api/admin/users/${d.user.id}`, { method: "PATCH", body: { name: d.name, email: d.email } });
      close();
      toast("Usuário atualizado.");
      reload();
    });

  const resetLink = (d: Extract<Dialog, { kind: "reset" }>, send: boolean) =>
    run(async () => {
      const r = await api<{ link: string; expiresAt: string; whatsappSent: boolean }>(`/api/admin/users/${d.user.id}/reset-link`, { method: "POST", body: { send } });
      setDialog({ ...d, ...r, sent: send });
    });

  async function remove(u: User) {
    if (!confirm(`Remover o acesso de ${u.name} (${u.email})? A pessoa é desconectada na hora e não consegue mais entrar.`)) return;
    try {
      await api(`/api/admin/users/${u.id}`, { method: "DELETE" });
      toast("Acesso removido.");
      reload();
    } catch (err) {
      toast(msg(err), false);
    }
  }

  return (
    <section className="card grid gap-4" aria-labelledby="users-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="users-title" className="font-semibold">Usuários com acesso ao painel</h2>
          <p className="mt-1 text-xs text-muted">Cada pessoa entra com o próprio e-mail e senha. Todos têm acesso completo ao painel.</p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setDialog({ kind: "create", name: "", email: "" })}><UserPlus size={16} aria-hidden /> Criar usuário</button>
      </div>

      {loading ? (
        <p className="text-sm text-muted">Carregando…</p>
      ) : (
        <ul className="divide-y divide-line">
          {users.map((u) => {
            const self = u.id === currentUserId;
            const blocked = self ? "Você não pode remover o seu próprio acesso." : users.length <= 1 ? "Não é possível remover o último usuário." : "";
            return (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium">
                    <span className="truncate">{u.name}</span>
                    {self && <span className="badge shrink-0 bg-brand/20 text-brand-soft">você</span>}
                  </p>
                  <p className="truncate text-sm text-muted">{u.email}</p>
                  <p className="mt-0.5 text-xs text-muted">Criado em {fmtDate(u.createdAt)} · Última sessão: {u.lastSessionAt ? fmtWhen(u.lastSessionAt) : "nenhuma ativa"}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button type="button" className="btn-ghost" aria-label={`Editar ${u.name}`} title="Editar" onClick={() => setDialog({ kind: "edit", user: u, name: u.name, email: u.email })}><Pencil size={15} aria-hidden /></button>
                  <button type="button" className="btn-ghost" aria-label={`Redefinir senha de ${u.name}`} title="Redefinir senha" onClick={() => setDialog({ kind: "reset", user: u })}><KeyRound size={15} aria-hidden /></button>
                  <button type="button" className="btn-danger" aria-label={`Remover ${u.name}`} title={blocked || "Remover"} disabled={Boolean(blocked)} onClick={() => remove(u)}><Trash2 size={15} aria-hidden /></button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {dialog?.kind === "create" && (
        <Modal title="Criar usuário" onClose={close}>
          <form onSubmit={(e) => { e.preventDefault(); create(dialog); }} className="space-y-4">
            <div>
              <label className="label" htmlFor="u-name">Nome</label>
              <input id="u-name" data-autofocus className="input" required minLength={2} maxLength={80} value={dialog.name} onChange={(e) => setDialog({ ...dialog, name: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="u-email">E-mail de login</label>
              <input id="u-email" type="email" className="input" required maxLength={120} autoComplete="off" value={dialog.email} onChange={(e) => setDialog({ ...dialog, email: e.target.value })} />
            </div>
            <p className="text-xs text-muted">A senha inicial é gerada pelo sistema e aparece uma única vez, na próxima tela.</p>
            {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
            <div className="flex gap-2 pt-1">
              <button className="btn-primary flex-1" disabled={busy}>{busy ? "Criando…" : "Criar usuário"}</button>
              <button type="button" className="btn-ghost" onClick={close}>Cancelar</button>
            </div>
          </form>
        </Modal>
      )}

      {dialog?.kind === "created" && (
        <Modal title="Usuário criado" onClose={close}>
          <div className="space-y-4">
            <p className="text-sm">Acesso criado para <strong>{dialog.user.name}</strong> ({dialog.user.email}).</p>
            <div>
              <label className="label" htmlFor="u-pass">Senha inicial</label>
              <input id="u-pass" className="input font-mono" readOnly value={dialog.password} onFocus={(e) => e.currentTarget.select()} />
            </div>
            <p className="text-xs text-muted">Anote ou copie agora: esta senha não será mostrada de novo. Peça para a pessoa trocar em Configurações → Acesso e senha depois de entrar.</p>
            <div className="flex gap-2 pt-1">
              <button type="button" data-autofocus className="btn-primary flex-1" onClick={() => copy(dialog.password, "Senha copiada.")}><Copy size={16} aria-hidden /> Copiar senha</button>
              <button type="button" className="btn-ghost" onClick={close}>Fechar</button>
            </div>
          </div>
        </Modal>
      )}

      {dialog?.kind === "edit" && (
        <Modal title="Editar usuário" onClose={close}>
          <form onSubmit={(e) => { e.preventDefault(); edit(dialog); }} className="space-y-4">
            <div>
              <label className="label" htmlFor="e-name">Nome</label>
              <input id="e-name" data-autofocus className="input" required minLength={2} maxLength={80} value={dialog.name} onChange={(e) => setDialog({ ...dialog, name: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="e-email">E-mail de login</label>
              <input id="e-email" type="email" className="input" required maxLength={120} autoComplete="off" value={dialog.email} onChange={(e) => setDialog({ ...dialog, email: e.target.value })} />
            </div>
            {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
            <div className="flex gap-2 pt-1">
              <button className="btn-primary flex-1" disabled={busy}>{busy ? "Salvando…" : "Salvar"}</button>
              <button type="button" className="btn-ghost" onClick={close}>Cancelar</button>
            </div>
          </form>
        </Modal>
      )}

      {dialog?.kind === "reset" && (
        <Modal title="Redefinir senha" onClose={close}>
          {!dialog.link ? (
            <div className="space-y-4">
              <p className="text-sm">Gerar um link para <strong>{dialog.user.name}</strong> ({dialog.user.email}) criar uma nova senha?</p>
              <p className="text-xs text-muted">O link vale 30 minutos, só pode ser usado uma vez e cancela os links anteriores. A senha atual continua valendo até a pessoa definir a nova.</p>
              {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
              <div className="flex flex-col gap-2 pt-1">
                <button type="button" data-autofocus className="btn-primary" disabled={busy} onClick={() => resetLink(dialog, false)}><KeyRound size={16} aria-hidden /> Gerar link</button>
                <button type="button" className="btn-ghost" disabled={busy} onClick={() => resetLink(dialog, true)}><Send size={16} aria-hidden /> Gerar e enviar para o WhatsApp do estúdio</button>
                <button type="button" className="btn-ghost" onClick={close}>Cancelar</button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {dialog.sent && (
                <p role="status" className={`text-sm ${dialog.whatsappSent ? "text-emerald-300" : "text-amber-300"}`}>
                  {dialog.whatsappSent ? "Link enviado para o WhatsApp do estúdio." : "Não foi possível enviar pelo WhatsApp (desconectado ou sem telefone do estúdio). Copie o link abaixo e envie você mesma."}
                </p>
              )}
              <div>
                <label className="label" htmlFor="r-link">Link de redefinição de {dialog.user.name}</label>
                <textarea id="r-link" rows={3} className="input break-all font-mono text-xs" readOnly value={dialog.link} onFocus={(e) => e.currentTarget.select()} />
              </div>
              <p className="text-xs text-muted">Vale até {dialog.expiresAt ? fmtWhen(dialog.expiresAt) : "30 minutos"} e só pode ser usado uma vez. Quem abrir este link define a senha: envie só para a própria pessoa. Ele não será mostrado de novo.</p>
              <div className="flex gap-2 pt-1">
                <button type="button" data-autofocus className="btn-primary flex-1" onClick={() => copy(dialog.link!, "Link copiado.")}><Copy size={16} aria-hidden /> Copiar link</button>
                <button type="button" className="btn-ghost" onClick={close}>Fechar</button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </section>
  );
}
