// Envio de e-mail pela API do Resend (POST https://api.resend.com/emails), sem SDK.
// Configuração: RESEND_API_KEY (chave só de envio) e EMAIL_FROM (remetente de um domínio verificado no Resend,
// ex.: "Bem-vindo Agenda <nao-responda@bemvindoagenda.com.br>"). Sem as duas, nada é enviado.
const RESEND_URL = "https://api.resend.com/emails";

export const emailConfigured = () => Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim());

export type EmailMessage = { to: string; subject: string; text: string; html: string };

// Devolve true quando o Resend aceitou o e-mail. Falhas (domínio não verificado, chave inválida, rede) viram false
// com um log de erro que nunca inclui a chave nem o corpo da mensagem.
export async function sendEmail(msg: EmailMessage): Promise<boolean> {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!key || !from) return false;
  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return true;
    const body = (await res.json().catch(() => null)) as { name?: string; message?: string } | null;
    console.error(`[e-mail] O Resend recusou o envio (HTTP ${res.status}${body?.name ? `, ${body.name}` : ""}): ${body?.message ?? "sem detalhes"}`);
    return false;
  } catch (e) {
    console.error("[e-mail] Falha ao falar com o Resend.", e instanceof Error ? e.message : "");
    return false;
  }
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
