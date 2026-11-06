// Opções de "Intervalo entre as opções de horário" (Configurações), em minutos. A validação do servidor usa a mesma lista.
export const SLOT_STEP_OPTIONS = [10, 15, 20, 30, 45, 60, 75, 90, 105, 120] as const;

// Convite para a cliente voltar. Várias versões separadas por uma linha "---" são sorteadas a cada envio.
export const DEFAULT_RETURN_TEMPLATE =
  "Oi {cliente}! Faz {dias} dias que você fez {servico} aqui no {negocio}. Que tal renovar? Responda aqui para agendar um horário. 💅\n---\nOlá {cliente}, tudo bem? Já faz um tempinho desde o seu último atendimento no {negocio}. Quer reservar um horário para renovar? Responda aqui. 💖\n---\nSentimos sua falta, {cliente}! Se quiser renovar {servico}, é só responder esta mensagem que a gente encontra um horário. Para não receber mais convites, responda SAIR.";

// Lembrete do dia anterior. Várias versões separadas por "---" são sorteadas a cada envio (menos cara de disparo em massa).
export const DEFAULT_REMINDER_TEMPLATE =
  "Oi {cliente}, lembrando do seu horário amanhã no {negocio}: {servico}, {data} às {hora}. Responda aqui se precisar remarcar.\n📍 Como chegar: {mapa}\n---\nOlá {cliente}! Passando para confirmar seu horário no {negocio}: {servico}, {data} às {hora}. Qualquer imprevisto, é só responder por aqui. 💅\n📍 Como chegar: {mapa}\n---\n{cliente}, tudo bem? Seu horário no {negocio} é {data} às {hora} ({servico}). Te esperamos! Se precisar remarcar, me avisa por aqui.\n📍 Como chegar: {mapa}";

// Aviso de remarcação feita pelo estúdio (Agenda > Reagendar).
export const DEFAULT_RESCHEDULE_TEMPLATE =
  "Olá {cliente}! Seu horário no {negocio} foi remarcado: {servico}, agora {data} às {hora}.\n📍 Como chegar: {mapa}\nQualquer dúvida, é só responder por aqui. 💅";

// Valores iniciais do registro único do estúdio (aplicados em getBusiness e no seed).
export const BUSINESS_DEFAULTS = {
  name: "Meu Estúdio",
  confirmationTemplate:
    "Olá {cliente}! Seu horário no {negocio} está confirmado: {servico}, {data} às {hora}.\n📍 Como chegar: {mapa}\nAté lá! 💅",
  reminderTemplate: DEFAULT_REMINDER_TEMPLATE,
};
