// Convite para a cliente voltar. Várias versões separadas por uma linha "---" são sorteadas a cada envio.
export const DEFAULT_RETURN_TEMPLATE =
  "Oi {cliente}! Faz {dias} dias que você fez {servico} aqui no {negocio}. Que tal renovar? Responda aqui para agendar um horário. 💅\n---\nOlá {cliente}, tudo bem? Já faz um tempinho desde o seu último atendimento no {negocio}. Quer reservar um horário para renovar? Responda aqui. 💖\n---\nSentimos sua falta, {cliente}! Se quiser renovar {servico}, é só responder esta mensagem que a gente encontra um horário. Para não receber mais convites, responda SAIR.";

// Valores iniciais do registro único do estúdio (aplicados em getBusiness e no seed).
export const BUSINESS_DEFAULTS = {
  name: "Meu Estúdio",
  confirmationTemplate:
    "Olá {cliente}! Seu horário no {negocio} está confirmado: {servico}, {data} às {hora}. Até lá! 💅",
  reminderTemplate:
    "Oi {cliente}, lembrando do seu horário amanhã no {negocio}: {servico}, {data} às {hora}. Responda aqui se precisar remarcar.",
};
