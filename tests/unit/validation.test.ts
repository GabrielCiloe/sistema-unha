import { describe, expect, it } from "vitest";
import {
  adminBookingSchema,
  bookingSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  PASSWORD_MIN,
  passwordProblem,
  passwordSchema,
  resetLinkSchema,
  resetPasswordSchema,
  userCreateSchema,
  userUpdateSchema,
} from "@/lib/validation";

const booking = { serviceIds: ["svc1"], startsAt: "2030-01-15T13:00:00.000Z", name: "Maria Silva", phone: "(11) 91234-5678" };

describe("bookingSchema", () => {
  it("aceita a reserva mínima e apara nome/telefone", () => {
    const r = bookingSchema.parse({ ...booking, name: "  Maria Silva  ", phone: " (11) 91234-5678 " });
    expect(r.name).toBe("Maria Silva");
    expect(r.phone).toBe("(11) 91234-5678");
    expect(r.notes).toBeUndefined();
  });

  it("exige de 1 a 6 serviços", () => {
    expect(bookingSchema.safeParse({ ...booking, serviceIds: [] }).success).toBe(false);
    expect(bookingSchema.safeParse({ ...booking, serviceIds: Array(6).fill("a") }).success).toBe(true);
    expect(bookingSchema.safeParse({ ...booking, serviceIds: Array(7).fill("a") }).success).toBe(false);
  });

  it("startsAt precisa ser ISO em UTC", () => {
    for (const startsAt of ["2030-01-15", "15/01/2030 10:00", "2030-01-15T10:00:00-03:00", "", "amanhã"])
      expect(bookingSchema.safeParse({ ...booking, startsAt }).success, startsAt).toBe(false);
  });

  it("limita nome, telefone e observações", () => {
    expect(bookingSchema.safeParse({ ...booking, name: "M" }).success).toBe(false);
    expect(bookingSchema.safeParse({ ...booking, name: "M".repeat(81) }).success).toBe(false);
    expect(bookingSchema.safeParse({ ...booking, phone: "1234567" }).success).toBe(false);
    expect(bookingSchema.safeParse({ ...booking, phone: "1".repeat(21) }).success).toBe(false);
    expect(bookingSchema.safeParse({ ...booking, notes: "x".repeat(300) }).success).toBe(true);
    expect(bookingSchema.safeParse({ ...booking, notes: "x".repeat(301) }).success).toBe(false);
  });

  it("unhas faltando: inteiro de 0 a 10 por serviço", () => {
    expect(bookingSchema.safeParse({ ...booking, missingNails: { svc1: 0, svc2: 10 } }).success).toBe(true);
    for (const n of [-1, 11, 1.5, "2"]) expect(bookingSchema.safeParse({ ...booking, missingNails: { svc1: n } }).success, String(n)).toBe(false);
  });

  it("descarta campos do painel (a rota pública não ganha as liberdades da dona)", () => {
    const r = bookingSchema.parse({ ...booking, allowToday: true, manualTime: "07:00", markDepositPaid: true, sendPix: true, source: "ADMIN" });
    expect(r).not.toHaveProperty("allowToday");
    expect(r).not.toHaveProperty("manualTime");
    expect(r).not.toHaveProperty("markDepositPaid");
    expect(r).not.toHaveProperty("sendPix");
    expect(r).not.toHaveProperty("source");
  });
});

describe("adminBookingSchema", () => {
  it("allowToday é true por padrão e os opcionais ficam indefinidos", () => {
    const r = adminBookingSchema.parse(booking);
    expect(r.allowToday).toBe(true);
    expect(r.manualTime).toBeUndefined();
    expect(r.markDepositPaid).toBeUndefined();
    expect(r.sendPix).toBeUndefined();
  });

  it("mantém as regras da reserva pública", () => {
    expect(adminBookingSchema.safeParse({ ...booking, serviceIds: [] }).success).toBe(false);
    expect(adminBookingSchema.safeParse({ ...booking, phone: "123" }).success).toBe(false);
  });

  it("manualTime aceita só HH:MM de 00:00 a 23:59", () => {
    for (const t of ["00:00", "07:05", "19:30", "23:59"]) expect(adminBookingSchema.safeParse({ ...booking, manualTime: t }).success, t).toBe(true);
    for (const t of ["24:00", "7:05", "07:60", "0705", "07:5", "07:05:00", " 07:05", "07:05\n", "aa:bb", "", "-1:00"])
      expect(adminBookingSchema.safeParse({ ...booking, manualTime: t }).success, JSON.stringify(t)).toBe(false);
  });

  it("flags precisam ser booleanas", () => {
    expect(adminBookingSchema.safeParse({ ...booking, allowToday: "true" }).success).toBe(false);
    expect(adminBookingSchema.safeParse({ ...booking, markDepositPaid: 1 }).success).toBe(false);
    expect(adminBookingSchema.safeParse({ ...booking, sendPix: "sim" }).success).toBe(false);
    expect(adminBookingSchema.parse({ ...booking, allowToday: false, markDepositPaid: true, sendPix: false })).toMatchObject({ allowToday: false, markDepositPaid: true, sendPix: false });
  });
});

describe("política de senha", () => {
  it("mínimo de 8 caracteres, com letra e número", () => {
    expect(PASSWORD_MIN).toBe(8);
    for (const p of ["abcdefg1", "Senha1234", "ção12345", "a1!@#$%^", "1234567a"]) expect(passwordSchema.safeParse(p).success, p).toBe(true);
    for (const p of ["", "abc1", "abcdef1", "abcdefgh", "12345678", "!@#$%^&*", "a".repeat(200) + "1"]) expect(passwordSchema.safeParse(p).success, p).toBe(false);
  });

  it("aceita até 200 caracteres", () => {
    expect(passwordSchema.safeParse("a1".repeat(100)).success).toBe(true);
  });

  it("passwordProblem devolve a primeira falha ou null", () => {
    expect(passwordProblem("Senha1234")).toBeNull();
    expect(passwordProblem("abc1")).toMatch(/pelo menos 8 caracteres/);
    expect(passwordProblem("abcdefgh")).toMatch(/um número/);
    expect(passwordProblem("12345678")).toMatch(/uma letra/);
  });
});

describe("schemas de senha e de usuário", () => {
  it("changePasswordSchema exige senha atual e aplica a política só na nova", () => {
    expect(changePasswordSchema.safeParse({ currentPassword: "x", newPassword: "NovaSenha1" }).success).toBe(true);
    expect(changePasswordSchema.safeParse({ currentPassword: "", newPassword: "NovaSenha1" }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ currentPassword: "x", newPassword: "fraca" }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ newPassword: "NovaSenha1" }).success).toBe(false);
  });

  it("forgotPasswordSchema normaliza o e-mail (apara e põe em minúsculas)", () => {
    expect(forgotPasswordSchema.parse({ email: "  Admin@Local.TEST " }).email).toBe("admin@local.test");
    for (const email of ["", "sem-arroba", "a@", "a@b", `${"a".repeat(120)}@b.co`]) expect(forgotPasswordSchema.safeParse({ email }).success, email).toBe(false);
  });

  it("resetPasswordSchema limita o token (20 a 200) e aplica a política", () => {
    const token = "t".repeat(43);
    expect(resetPasswordSchema.safeParse({ token, password: "NovaSenha1" }).success).toBe(true);
    expect(resetPasswordSchema.safeParse({ token: "t".repeat(19), password: "NovaSenha1" }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ token: "t".repeat(201), password: "NovaSenha1" }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ token, password: "semnumero" }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ password: "NovaSenha1" }).success).toBe(false);
  });

  it("userCreateSchema: nome de 2 a 80 e e-mail válido; senha nunca vem do formulário", () => {
    const r = userCreateSchema.parse({ name: " Ana ", email: "ANA@Local.test", password: "Escolhida1", passwordHash: "x" });
    expect(r).toEqual({ name: "Ana", email: "ana@local.test" });
    expect(userCreateSchema.safeParse({ name: "A", email: "ana@local.test" }).success).toBe(false);
    expect(userCreateSchema.safeParse({ name: "Ana", email: "ana" }).success).toBe(false);
    expect(userCreateSchema.safeParse({ name: "Ana" }).success).toBe(false);
  });

  it("userUpdateSchema: nome e/ou e-mail; vazio não vale; descarta passwordHash", () => {
    expect(userUpdateSchema.parse({ name: "Ana Maria" })).toEqual({ name: "Ana Maria" });
    expect(userUpdateSchema.parse({ email: "Nova@Local.test" })).toEqual({ email: "nova@local.test" });
    expect(userUpdateSchema.safeParse({}).success).toBe(false);
    expect(userUpdateSchema.safeParse({ passwordHash: "x" }).success).toBe(false);
    expect(userUpdateSchema.parse({ name: "Ana Maria", passwordHash: "x", id: "outro" })).toEqual({ name: "Ana Maria" });
  });

  it("resetLinkSchema: send opcional e booleano", () => {
    expect(resetLinkSchema.parse({})).toEqual({});
    expect(resetLinkSchema.parse({ send: true })).toEqual({ send: true });
    expect(resetLinkSchema.safeParse({ send: "1" }).success).toBe(false);
  });
});
