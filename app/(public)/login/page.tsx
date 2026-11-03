"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";

export default function LoginPage() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [brand, setBrand] = useState<{ name: string; logoUrl: string | null } | null>(null);

  useEffect(() => {
    api<{ business: { name: string; logoUrl: string | null } }>("/api/public/info").then((r) => setBrand(r.business)).catch(() => {});
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
      {/* Mesma logo da tela da cliente (BrandHeader): 350 px, centralizada, sem moldura. */}
      <div className="mb-8 flex flex-col items-center gap-3 text-center">
        {brand?.logoUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={brand.logoUrl} alt={`Logo de ${brand.name}`} className="mx-auto h-auto w-[350px] max-w-full object-contain" />
            <h1 className="sr-only">{brand.name}</h1>
          </>
        ) : (
          <h1 className="text-3xl font-semibold text-accent">{brand?.name ?? "Painel do estúdio"}</h1>
        )}
        <p className="text-xs text-muted">Acesso do administrador</p>
      </div>
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
      </form>
    </main>
  );
}
