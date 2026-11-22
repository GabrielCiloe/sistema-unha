import { normalizePhone, phoneVariants } from "./whatsapp";

// Filtro do autocomplete de clientes (popup "Novo agendamento"): trecho do nome OU telefone por prefixo.
// Só o que foi digitado como telefone (dígitos e máscara) procura por telefone, com ou sem o DDI 55.
// Com o número completo (DDD + número), procura também a outra forma do nono dígito: a cliente pode estar
// cadastrada sem o 9 e a dona digitar com ele (ou o contrário) — é o mesmo cadastro que createBooking reaproveita.
export function autocompleteWhere(q: string) {
  const digits = q.replace(/\D/g, "");
  const phoneLike = digits.length > 0 && /^[\d\s()+\-.]+$/.test(q);
  const national = digits.length > 11 && digits.startsWith("55") ? digits.slice(2) : digits;
  const complete = national.length === 10 || national.length === 11;
  return {
    OR: [
      { name: { contains: q, mode: "insensitive" as const } },
      ...(phoneLike ? [{ phone: { startsWith: digits } }, { phone: { startsWith: `55${digits}` } }] : []),
      ...(phoneLike && complete ? [{ phone: { in: phoneVariants(normalizePhone(national)) } }] : []),
    ],
  };
}
