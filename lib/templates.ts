const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", ...opts }).format(d);

// Link universal do Google Maps (sem chave): abre o app de mapas no celular já com o destino.
// Usa o endereço cadastrado para o mapa; se só houver coordenadas antigas, usa elas.
export function mapsUrl(b: { mapsAddress?: string | null; latitude?: number | null; longitude?: number | null }) {
  const q = (b.mapsAddress ?? "").trim();
  if (q) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  if (b.latitude != null && b.longitude != null) return `https://www.google.com/maps/search/?api=1&query=${b.latitude.toFixed(6)},${b.longitude.toFixed(6)}`;
  return null;
}
// Prévia incorporável (iframe) do mesmo endereço.
export const mapsEmbedUrl = (address: string) => `https://www.google.com/maps?q=${encodeURIComponent(address.trim())}&output=embed`;

export function renderTemplate(
  tpl: string,
  v: { cliente: string; negocio: string; servico: string; startsAt: Date; dias?: number; endereco?: string; mapa?: string | null },
) {
  // Se o texto não usa {mapa} mas o estúdio tem localização, o link "Como chegar" entra no fim.
  if (v.mapa && !tpl.includes("{mapa}")) tpl = `${tpl}\n\n📍 Como chegar: {mapa}`;
  // Sem localização, as linhas que só existem por causa do link saem inteiras.
  if (!v.mapa) tpl = tpl.split("\n").filter((l) => !l.includes("{mapa}")).join("\n");
  return tpl
    .replaceAll("{dias}", String(v.dias ?? 0))
    .replaceAll("{endereco}", v.endereco ?? "")
    .replaceAll("{mapa}", v.mapa ?? "")
    .replaceAll("{cliente}", v.cliente.split(" ")[0])
    .replaceAll("{negocio}", v.negocio)
    .replaceAll("{servico}", v.servico)
    .replaceAll("{data}", fmt(v.startsAt, { weekday: "long", day: "2-digit", month: "2-digit" }))
    .replaceAll("{hora}", fmt(v.startsAt, { hour: "2-digit", minute: "2-digit" }));
}

export const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// 120 -> "2h", 90 -> "1h30", 45 -> "45 min"
export const fmtDuration = (m: number) => {
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h === 0 ? `${r} min` : r === 0 ? `${h}h` : `${h}h${String(r).padStart(2, "0")}`;
};
// 120 -> "2 horas", 90 -> "1h30", 45 -> "45 minutos"
export const fmtEstimate = (m: number) => {
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} minutos`;
  if (r === 0) return h === 1 ? "1 hora" : `${h} horas`;
  return `${h}h${String(r).padStart(2, "0")}`;
};

export const fmtDateTime = (d: Date | string) =>
  fmt(new Date(d), { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

// Agendamento interno > "Enviar pelo WhatsApp": reserva + sinal, com o código copia e cola sozinho na última linha.
// `deadline`: hora-limite do sinal (reserva da página pública); sem ela (agendamento interno) não se promete prazo.
export function pixReservationText(v: {
  cliente: string;
  negocio: string;
  servico: string;
  startsAt: Date;
  totalCents: number;
  depositCents: number;
  pixPayload: string;
  link?: string | null;
  deadline?: string | null;
}) {
  return [
    `Olá ${v.cliente.split(" ")[0]}! Seu horário no ${v.negocio} está reservado:`,
    v.servico,
    fmtDateTime(v.startsAt),
    `Total: ${brl(v.totalCents)}`,
    "",
    `Para confirmar, pague o sinal de ${brl(v.depositCents)} por Pix e envie o comprovante por aqui` + (v.link ? ` ou pelo link: ${v.link}` : "") + ".",
    v.deadline ? `A vaga fica reservada até ${v.deadline}.` : "Envie o comprovante antes do horário do atendimento.",
    "",
    "Pix copia e cola:",
    v.pixPayload,
  ].join("\n");
}

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
