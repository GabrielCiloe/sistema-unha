const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", ...opts }).format(d);

export function renderTemplate(
  tpl: string,
  v: { cliente: string; negocio: string; servico: string; startsAt: Date; dias?: number },
) {
  return tpl
    .replaceAll("{dias}", String(v.dias ?? 0))
    .replaceAll("{cliente}", v.cliente.split(" ")[0])
    .replaceAll("{negocio}", v.negocio)
    .replaceAll("{servico}", v.servico)
    .replaceAll("{data}", fmt(v.startsAt, { weekday: "long", day: "2-digit", month: "2-digit" }))
    .replaceAll("{hora}", fmt(v.startsAt, { hour: "2-digit", minute: "2-digit" }));
}

export const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const fmtDateTime = (d: Date | string) =>
  fmt(new Date(d), { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

// Máscara de digitação (sem DDI): 19997939514 -> (19) 99793-9514; aceita fixo (10 dígitos) e colado com +55.
export function maskPhone(v: string) {
  let d = v.replace(/\D/g, "");
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  d = d.slice(0, 11);
  if (d.length <= 2) return d ? `(${d}` : "";
  const head = d.length > 10 ? 7 : 6;
  if (d.length <= head) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, head)}-${d.slice(head)}`;
}

// 5519997939514 -> +55 (19) 99793-9514
export function formatPhone(p: string) {
  const m = p.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : `+${p}`;
}
