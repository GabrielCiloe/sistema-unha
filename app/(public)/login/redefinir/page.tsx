"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LoginBrand } from "@/components/login-brand";
import { api } from "@/lib/client";
import { PASSWORD_HINT, passwordProblem } from "@/lib/validation";

export default function ResetPasswordPage() {
  // undefined = ainda lendo a URL; "" = link sem token.
  const [token, setToken] = useState<string>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token") ?? "");
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const password = String(f.get("password") ?? "");
    const problem = passwordProblem(password);
    if (problem) return setError(problem);
    if (password !== f.get("confirm")) return setError("A confirmação não confere com a nova senha.");
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/reset", { method: "POST", body: { token, password } });
      window.location.href = "/login?senha=redefinida";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <LoginBrand subtitle="Criar nova senha" />
      {token === undefined ? null : !token ? (
        <div role="alert" className="card space-y-3 text-sm">
          <h2 className="font-semibold">Link incompleto</h2>
          <p>Este endereço não tem o código de redefinição. Abra o link exatamente como recebeu ou peça um novo.</p>
          <Link href="/login/recuperar" className="btn-primary w-full">Pedir novo link</Link>
        </div>
      ) : (
        <form method="post" onSubmit={submit} className="card space-y-4">
          <div>
            <label className="label" htmlFor="password">Nova senha</label>
            <input id="password" name="password" type="password" autoComplete="new-password" required className="input" />
            <p className="mt-1 text-xs text-muted">{PASSWORD_HINT}</p>
          </div>
          <div>
            <label className="label" htmlFor="confirm">Confirmar nova senha</label>
            <input id="confirm" name="confirm" type="password" autoComplete="new-password" required className="input" />
          </div>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <button disabled={busy} className="btn-primary w-full">{busy ? "Salvando…" : "Salvar nova senha"}</button>
          <p className="text-center text-sm">
            <Link href="/login/recuperar" className="text-brand-soft underline">Pedir novo link</Link>
          </p>
        </form>
      )}
    </main>
  );
}
