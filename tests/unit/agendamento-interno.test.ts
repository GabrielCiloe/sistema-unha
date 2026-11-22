import { beforeEach, describe, expect, it, vi } from "vitest";

// Banco e WhatsApp simulados: só o que confirmPayment e sendPixMessage usam. O comportamento com o Postgres de verdade
// (transação, conflito real de horário) fica nos testes de fluxo (Playwright).
type Appt = { id: string; status: string; source: "PUBLIC" | "ADMIN"; startsAt: Date; endsAt: Date; holdUntil: Date };
const state = vi.hoisted(() => ({
  payment: null as null | { id: string; appointmentId: string; status: string; amountCents: number; pixPayload: string | null },
  appt: null as null | Appt,
  clash: false,
  clashWhere: null as unknown,
  sendResults: [] as boolean[],
  sent: [] as string[],
}));

vi.mock("@/lib/server/db", () => {
  const appointment = {
    async findUnique({ include }: { include?: unknown }) {
      if (!state.appt) return null;
      // sendPixMessage lê o atendimento com cliente, itens e o pagamento mais recente.
      return include
        ? { ...state.appt, customerId: "5511912345678", publicToken: "tok", totalCents: 5000, customer: { name: "Maria Silva", phone: "5511912345678" }, items: [{ name: "Manicure" }], payments: state.payment ? [state.payment] : [] }
        : state.appt;
    },
    async findFirst({ where }: { where: unknown }) {
      state.clashWhere = where;
      return state.clash ? { id: "outro" } : null;
    },
    async update({ data }: { data: Partial<Appt> }) {
      Object.assign(state.appt!, data);
      return state.appt;
    },
  };
  const payment = {
    async findUnique() {
      return state.payment;
    },
    async update({ data }: { data: { status: string } }) {
      Object.assign(state.payment!, data);
      return state.payment;
    },
  };
  const db = { appointment, payment, $transaction: async (fn: (tx: unknown) => unknown) => fn({ appointment, payment }) };
  return {
    db,
    getBusiness: async () => ({ name: "Estúdio", bufferMinutes: 10, confirmationTemplate: "Confirmado, {cliente}!", address: "", mapsAddress: "", latitude: null, longitude: null }),
  };
});

vi.mock("@/lib/server/whatsapp", async (original) => ({
  ...(await original<typeof import("@/lib/server/whatsapp")>()),
  sendText: async (_phone: string, text: string) => {
    state.sent.push(text);
    return state.sendResults.shift() ?? false;
  },
}));

import { holdUntilFor } from "@/lib/booking-math";
import { isWriteConflict } from "@/lib/server/bookings";
import { autocompleteWhere } from "@/lib/server/customer-search";
import { confirmPayment, sendPixMessage, SLOT_TAKEN_MESSAGE } from "@/lib/server/payments";
import { pixReservationText } from "@/lib/templates";

const HOUR = 3600_000;
const PIX = "00020126PIXCOPIAECOLA6304ABCD";

beforeEach(() => {
  const startsAt = new Date(Date.now() + 48 * HOUR);
  state.appt = { id: "a1", status: "PENDING_PAYMENT", source: "ADMIN", startsAt, endsAt: new Date(startsAt.getTime() + HOUR), holdUntil: startsAt };
  state.payment = { id: "p1", appointmentId: "a1", status: "PENDING", amountCents: 1500, pixPayload: PIX };
  state.clash = false;
  state.clashWhere = null;
  state.sendResults = [];
  state.sent = [];
});

describe("holdUntilFor (prazo da vaga sem sinal)", () => {
  const now = Date.UTC(2030, 0, 10, 12, 0);

  it("página pública: 30 min a partir de agora, qualquer que seja a data do atendimento", () => {
    expect(holdUntilFor("PUBLIC", new Date(now + 72 * HOUR), now, 30).getTime()).toBe(now + 30 * 60_000);
    expect(holdUntilFor("PUBLIC", new Date(now + 10 * 60_000), now, 30).getTime()).toBe(now + 30 * 60_000);
  });

  it("agendamento interno: a vaga fica bloqueada até o horário do atendimento", () => {
    const startsAt = new Date(now + 72 * HOUR);
    expect(holdUntilFor("ADMIN", startsAt, now, 30)).toBe(startsAt);
  });

  it("agendamento interno em cima da hora nunca tem prazo menor que o da página pública", () => {
    expect(holdUntilFor("ADMIN", new Date(now + 5 * 60_000), now, 30).getTime()).toBe(now + 30 * 60_000);
  });
});

describe("isWriteConflict (P2034 do Prisma vira 409 de horário ocupado)", () => {
  it("reconhece o erro de serialização e ignora os demais", () => {
    expect(isWriteConflict(Object.assign(new Error("write conflict"), { code: "P2034" }))).toBe(true);
    expect(isWriteConflict(Object.assign(new Error("unique"), { code: "P2002" }))).toBe(false);
    expect(isWriteConflict(new Error("x"))).toBe(false);
    expect(isWriteConflict(null)).toBe(false);
  });
});

describe("autocompleteWhere (busca de clientes do popup)", () => {
  const phones = (q: string) => autocompleteWhere(q).OR.slice(1);

  it("texto com letras procura só por nome", () => {
    expect(autocompleteWhere("Maria 2").OR).toEqual([{ name: { contains: "Maria 2", mode: "insensitive" } }]);
  });

  it("dígitos parciais procuram por prefixo, com e sem o DDI", () => {
    expect(phones("(11) 91")).toEqual([{ phone: { startsWith: "1191" } }, { phone: { startsWith: "551191" } }]);
  });

  it("número completo com o 9 também acha o cadastro salvo sem o 9", () => {
    expect(phones("(11) 91234-5678")).toContainEqual({ phone: { in: ["5511912345678", "551112345678"] } });
  });

  it("número completo sem o 9 também acha o cadastro salvo com o 9", () => {
    expect(phones("11 8765-4321")).toContainEqual({ phone: { in: ["551187654321", "5511987654321"] } });
  });

  it("aceita o número completo colado com +55", () => {
    expect(phones("+55 11 91234-5678")).toContainEqual({ phone: { in: ["5511912345678", "551112345678"] } });
  });
});

describe("pixReservationText (mensagem do Pix copia e cola)", () => {
  const base = { cliente: "Maria Silva", negocio: "Estúdio", servico: "Manicure", startsAt: new Date("2030-01-15T13:00:00.000Z"), totalCents: 5000, depositCents: 1500, pixPayload: PIX };

  it("termina com o código sozinho na última linha", () => {
    const lines = pixReservationText(base).split("\n");
    expect(lines.at(-1)).toBe(PIX);
    expect(lines.at(-2)).toBe("Pix copia e cola:");
    expect(lines[0]).toBe("Olá Maria! Seu horário no Estúdio está reservado:");
  });

  it("agendamento interno (sem prazo) não promete hora-limite", () => {
    const text = pixReservationText({ ...base, deadline: null });
    expect(text).not.toContain("A vaga fica reservada até");
    expect(text).toContain("Envie o comprovante antes do horário do atendimento.");
  });

  it("reserva pública mostra o prazo e o link quando existem", () => {
    const text = pixReservationText({ ...base, deadline: "14:30", link: "https://x.test/reserva/tok" });
    expect(text).toContain("A vaga fica reservada até 14:30.");
    expect(text).toContain("ou pelo link: https://x.test/reserva/tok.");
  });
});

describe("confirmPayment", () => {
  it("confirma quando o horário está livre e é idempotente", async () => {
    expect(await confirmPayment("p1")).toBe(true);
    expect(state.payment!.status).toBe("PAID");
    expect(state.appt!.status).toBe("CONFIRMED");
    expect(await confirmPayment("p1")).toBe(false);
  });

  it("não ressuscita reserva cancelada/expirada por cima de outro atendimento (409)", async () => {
    state.appt!.status = "CANCELLED";
    state.payment!.status = "EXPIRED";
    state.clash = true;
    await expect(confirmPayment("p1")).rejects.toMatchObject({ status: 409, message: SLOT_TAKEN_MESSAGE });
    expect(state.payment!.status).toBe("EXPIRED");
    expect(state.appt!.status).toBe("CANCELLED");
  });

  it("reserva cancelada/expirada com o horário ainda livre pode ser confirmada", async () => {
    state.appt!.status = "CANCELLED";
    state.payment!.status = "EXPIRED";
    expect(await confirmPayment("p1")).toBe(true);
    expect(state.appt!.status).toBe("CONFIRMED");
  });

  it("reserva que ainda segura a própria vaga não confere conflito (prazo correndo ou comprovante em análise)", async () => {
    // Vizinha dentro da pausa (ex.: a dona aumentou a pausa depois das reservas): não pode barrar um comprovante legítimo.
    state.clash = true;
    expect(await confirmPayment("p1")).toBe(true);
    expect(state.clashWhere).toBeNull();

    state.appt!.status = "PENDING_PAYMENT";
    state.appt!.holdUntil = new Date(Date.now() - HOUR); // prazo vencido, mas o comprovante chegou e está em análise
    state.payment!.status = "IN_REVIEW";
    expect(await confirmPayment("p1")).toBe(true);
    expect(state.clashWhere).toBeNull();
  });

  it("prazo do sinal vencido sem comprovante: confere conflito antes de confirmar", async () => {
    state.appt!.holdUntil = new Date(Date.now() - HOUR);
    state.clash = true;
    await expect(confirmPayment("p1")).rejects.toMatchObject({ status: 409, message: SLOT_TAKEN_MESSAGE });
    expect(state.appt!.status).toBe("PENDING_PAYMENT");
    state.clash = false;
    expect(await confirmPayment("p1")).toBe(true);
  });

  it("procura conflito no horário do próprio atendimento, sem contar ele mesmo e com a pausa do estúdio", async () => {
    state.appt!.status = "CANCELLED";
    state.payment!.status = "EXPIRED";
    await confirmPayment("p1");
    const where = state.clashWhere as { id: { not: string }; startsAt: { lt: Date }; endsAt: { gt: Date } };
    expect(where.id).toEqual({ not: "a1" });
    expect(where.startsAt.lt.getTime()).toBe(state.appt!.endsAt.getTime() + 10 * 60_000);
    expect(where.endsAt.gt.getTime()).toBe(state.appt!.startsAt.getTime() - 10 * 60_000);
  });
});

describe("sendPixMessage", () => {
  it("WhatsApp desconectado: devolve false e não insiste na segunda mensagem", async () => {
    state.sendResults = [false];
    expect(await sendPixMessage("a1")).toBe(false);
    expect(state.sent).toHaveLength(1);
  });

  it("manda a mensagem completa e depois só o código", async () => {
    state.sendResults = [true, true];
    expect(await sendPixMessage("a1")).toBe(true);
    expect(state.sent).toHaveLength(2);
    expect(state.sent[0].split("\n").at(-1)).toBe(PIX);
    expect(state.sent[1]).toBe(PIX);
  });

  it("se só a primeira mensagem sair, o envio conta como feito (ela já traz o código)", async () => {
    state.sendResults = [true, false];
    expect(await sendPixMessage("a1")).toBe(true);
    expect(state.sent[0]).toContain(PIX);
  });

  it("agendamento interno não anuncia prazo; reserva pública anuncia", async () => {
    state.sendResults = [true, true, true, true];
    await sendPixMessage("a1");
    expect(state.sent[0]).not.toContain("A vaga fica reservada até");
    state.appt!.source = "PUBLIC";
    state.appt!.holdUntil = new Date(Date.now() + 20 * 60_000);
    await sendPixMessage("a1");
    expect(state.sent[2]).toMatch(/A vaga fica reservada até \d{2}:\d{2}\./);
  });

  it("sinal já pago: 409", async () => {
    state.payment!.status = "PAID";
    await expect(sendPixMessage("a1")).rejects.toMatchObject({ status: 409 });
  });
});
