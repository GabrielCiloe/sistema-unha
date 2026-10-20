"use client";

import { Sparkles } from "lucide-react";
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
      <div className="mb-8 flex flex-col items-center gap-3 text-center">
        <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-line bg-surface">
          {brand?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logoUrl} alt="" className="h-full w-full object-contain p-1.5" />
          ) : (
            <Sparkles className="text-accent" size={28} aria-hidden />
          )}
        </div>
        <p className="text-lg font-semibold">{brand?.name ?? "Painel do estúdio"}</p>
        <p className="-mt-2 text-xs text-muted">Acesso do administrador</p>
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
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        <button disabled={busy} className="btn-primary w-full">{busy ? "Entrando…" : "Entrar"}</button>
      </form>
    </main>
  );
}
