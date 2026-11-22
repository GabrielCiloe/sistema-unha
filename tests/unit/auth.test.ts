import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/db", () => ({ db: {} }));

import { hashPassword, verifyPassword } from "@/lib/server/auth";

describe("hash de senha (scrypt)", () => {
  it("guarda sal:hash em hexadecimal, nunca a senha", () => {
    const stored = hashPassword("Senha1234");
    expect(stored).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    expect(stored).not.toContain("Senha1234");
  });

  it("sal aleatório: a mesma senha gera hashes diferentes", () => {
    expect(hashPassword("Senha1234")).not.toBe(hashPassword("Senha1234"));
  });

  it("confere a senha certa e recusa a errada", () => {
    const stored = hashPassword("Senha1234");
    expect(verifyPassword("Senha1234", stored)).toBe(true);
    expect(verifyPassword("senha1234", stored)).toBe(false);
    expect(verifyPassword("", stored)).toBe(false);
  });

  it("hash guardado malformado nunca confere", () => {
    for (const stored of ["", "semdoispontos", "aa:", ":bb", "aa:zz", "aa:zzzz", "00:00", `${"0".repeat(32)}:${"z".repeat(128)}`, `${"0".repeat(32)}:abc`])
      expect(verifyPassword("qualquer", stored), JSON.stringify(stored)).toBe(false);
  });
});
