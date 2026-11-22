"use client";

import Link from "next/link";
import { useState } from "react";
import { LoginBrand } from "@/components/login-brand";
import { api } from "@/lib/client";

export default function ForgotPasswordPage() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/forgot", { method: "POST", body: { email: f.get("email") } });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <LoginBrand subtitle="Recuperar acesso" />
      {done ? (
        // A mesma mensagem para qualquer e-mail: a tela não revela quem tem acesso ao painel
        // nem por qual canal o link saiu (e-mail, WhatsApp do estúdio ou log do servidor).
        <div role="status" className="card space-y-3 text-sm">
          <h2 className="font-semibold">Pedido recebido</h2>
          <p>Se este e-mail tiver acesso ao painel, enviamos para ele o link para criar uma nova senha (confira também a caixa de spam). Se o envio por e-mail não estiver disponível, o link vai para o WhatsApp do estúdio. Ele vale 30 minutos e só pode ser usado uma vez.</p>
          <p className="text-muted">Não chegou em alguns minutos? Peça ao suporte o link de redefinição.</p>
          <Link href="/login" className="btn-ghost w-full">Voltar para o login</Link>
        </div>
      ) : (
        <form method="post" onSubmit={submit} className="card space-y-4">
          <p className="text-sm text-muted">Informe o e-mail que você usa para entrar. O link de redefinição é enviado para esse e-mail (ou, se o envio por e-mail não estiver disponível, para o WhatsApp do estúdio).</p>
          <div>
            <label className="label" htmlFor="email">E-mail</label>
            <input id="email" name="email" type="email" autoComplete="username" required maxLength={120} className="input" />
          </div>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <button disabled={busy} className="btn-primary w-full">{busy ? "Enviando…" : "Enviar link de redefinição"}</button>
          <p className="text-center text-sm">
            <Link href="/login" className="text-brand-soft underline">Voltar para o login</Link>
          </p>
        </form>
      )}
    </main>
  );
}
