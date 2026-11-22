"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LoginBrand } from "@/components/login-brand";
import { toast, Toaster } from "@/components/toast";
import { api } from "@/lib/client";

export default function LoginPage() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Volta de /login/redefinir: avisa que a senha foi trocada e limpa o parâmetro da URL.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("senha") !== "redefinida") return;
    toast("Senha redefinida! Entre com a nova senha.");
    window.history.replaceState(null, "", "/login");
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/login", { method: "POST", body: { email: f.get("email"), password: f.get("password") } });
      window.location.href = "/admin";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <LoginBrand subtitle="Acesso do administrador" />
      {/* method=post: se o JS ainda não carregou, as credenciais nunca vão na URL (GET). */}
      <form method="post" onSubmit={submit} className="card space-y-4">
        <div>
          <label className="label" htmlFor="email">E-mail</label>
          <input id="email" name="email" type="email" autoComplete="username" required className="input" />
        </div>
        <div>
          <label className="label" htmlFor="password">Senha</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
        </div>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button disabled={busy} className="btn-primary w-full">{busy ? "Entrando…" : "Entrar"}</button>
        <p className="text-center text-sm">
          <Link href="/login/recuperar" className="text-brand-soft underline">Esqueci minha senha</Link>
        </p>
      </form>
      <Toaster />
    </main>
  );
}
