import { describe, expect, it } from "vitest";
import { buildPixPayload, crc16, normalizePixKey } from "@/lib/pix";

// Lê os campos EMV (ID de 2 dígitos + tamanho de 2 dígitos + valor) e confere que a string é consumida inteira.
function tlv(s: string) {
  const out: [string, string][] = [];
  let i = 0;
  while (i < s.length) {
    const id = s.slice(i, i + 2);
    const len = Number(s.slice(i + 2, i + 4));
    expect(Number.isInteger(len), `tamanho do campo ${id}`).toBe(true);
    const value = s.slice(i + 4, i + 4 + len);
    expect(value.length, `campo ${id} truncado`).toBe(len);
    out.push([id, value]);
    i += 4 + len;
  }
  expect(i).toBe(s.length);
  return out;
}
const fields = (s: string) => Object.fromEntries(tlv(s));

const base = { key: "111.444.777-35", name: "Studio Teste", city: "Sao Paulo", amount: 13.5, txid: "cmabc123XYZ" };

describe("crc16 (CCITT-FALSE, polinômio 0x1021, inicial 0xFFFF)", () => {
  it("bate com os vetores conhecidos", () => {
    expect(crc16("123456789")).toBe("29B1");
    expect(crc16("")).toBe("FFFF");
  });

  it("sempre 4 dígitos hexadecimais maiúsculos", () => {
    for (const s of ["a", "ab", "abc", "0002010102", "x".repeat(200)]) expect(crc16(s)).toMatch(/^[0-9A-F]{4}$/);
  });
});

describe("buildPixPayload", () => {
  const payload = buildPixPayload(base);

  it("tem a estrutura EMV do BR Code, na ordem certa", () => {
    expect(tlv(payload).map(([id]) => id)).toEqual(["00", "26", "52", "53", "54", "58", "59", "60", "62", "63"]);
    const f = fields(payload);
    expect(f["00"]).toBe("01"); // versão do payload
    expect(f["52"]).toBe("0000"); // MCC
    expect(f["53"]).toBe("986"); // BRL
    expect(f["58"]).toBe("BR");
  });

  it("conta da chave: GUI do Banco Central + chave normalizada", () => {
    const account = fields(fields(payload)["26"]);
    expect(account["00"]).toBe("br.gov.bcb.pix");
    expect(account["01"]).toBe("11144477735");
  });

  it("valor com ponto e duas casas", () => {
    expect(fields(payload)["54"]).toBe("13.50");
    expect(fields(buildPixPayload({ ...base, amount: 0.01 }))["54"]).toBe("0.01");
    expect(fields(buildPixPayload({ ...base, amount: 1234.5 }))["54"]).toBe("1234.50");
    expect(fields(buildPixPayload({ ...base, amount: 1350 / 100 }))["54"]).toBe("13.50");
    expect(fields(buildPixPayload({ ...base, amount: 4990 / 100 }))["54"]).toBe("49.90");
  });

  it("valor em centavos nunca perde precisão (todo sinal de R$ 0,01 a R$ 300,00)", () => {
    for (let cents = 1; cents <= 30_000; cents++) {
      const expected = `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
      if ((cents / 100).toFixed(2) !== expected) throw new Error(`${cents} centavos viraram ${(cents / 100).toFixed(2)}`);
    }
    expect(fields(buildPixPayload({ ...base, amount: 29999 / 100 }))["54"]).toBe("299.99");
  });

  it("CRC16 no fim, calculado sobre tudo até 6304", () => {
    expect(payload).toMatch(/6304[0-9A-F]{4}$/);
    expect(payload.slice(-4)).toBe(crc16(payload.slice(0, -4)));
    // Qualquer alteração no conteúdo invalida o CRC.
    const tampered = payload.replace("13.50", "13.51");
    expect(tampered.slice(-4)).not.toBe(crc16(tampered.slice(0, -4)));
  });

  it("nome (até 25) e cidade (até 15): sem acento, maiúsculas, sem símbolos", () => {
    const f = fields(buildPixPayload({ ...base, name: "Estúdio da Júlia & Cia. Unhas de Gel Ltda", city: "São José dos Campos" }));
    expect(f["59"]).toBe("ESTUDIO DA JULIA CIA UNHA");
    expect(f["59"].length).toBeLessThanOrEqual(25);
    expect(f["60"]).toBe("SAO JOSE DOS CA");
    expect(f["60"].length).toBeLessThanOrEqual(15);
    expect(f["59"] + f["60"]).toMatch(/^[A-Z0-9 ]+$/);
  });

  it("nome ou cidade vazios viram NA; cidade padrão BRASIL", () => {
    expect(fields(buildPixPayload({ ...base, name: "", city: "!!!" }))).toMatchObject({ "59": "NA", "60": "NA" });
    expect(fields(buildPixPayload({ key: base.key, name: "Ana", amount: 1 }))["60"]).toBe("BRASIL");
  });

  it("txid: só letras e números, até 25; sem txid usa ***", () => {
    expect(fields(fields(payload)["62"])["05"]).toBe("cmabc123XYZ");
    expect(fields(fields(buildPixPayload({ ...base, txid: "ab-cd_ef 12" }))["62"])["05"]).toBe("abcdef12");
    expect(fields(fields(buildPixPayload({ ...base, txid: "a".repeat(40) }))["62"])["05"]).toBe("a".repeat(25));
    expect(fields(fields(buildPixPayload({ ...base, txid: "---" }))["62"])["05"]).toBe("***");
    expect(fields(fields(buildPixPayload({ key: base.key, name: "Ana", amount: 1 }))["62"])["05"]).toBe("***");
  });

  it("todo campo declara o próprio tamanho com 2 dígitos (inclusive com chave longa)", () => {
    const long = buildPixPayload({ ...base, key: `${"a".repeat(60)}@exemplo.com.br`, name: "N".repeat(60), city: "C".repeat(60), txid: "t".repeat(60) });
    for (const [id, value] of tlv(long)) {
      expect(id).toMatch(/^\d{2}$/);
      expect(value.length).toBeLessThanOrEqual(99);
    }
    expect(long.slice(-4)).toBe(crc16(long.slice(0, -4)));
  });

  it("é determinístico e só usa ASCII", () => {
    expect(buildPixPayload(base)).toBe(payload);
    expect(payload).toMatch(/^[\x20-\x7E]+$/);
  });

  it("recusa valor zero, negativo ou inválido", () => {
    for (const amount of [0, -1, NaN]) expect(() => buildPixPayload({ ...base, amount })).toThrow(/positivo/);
  });
});

describe("normalizePixKey", () => {
  it("CPF e CNPJ só com dígitos", () => {
    expect(normalizePixKey("111.444.777-35")).toBe("11144477735");
    expect(normalizePixKey("12.345.678/0001-95")).toBe("12345678000195");
  });
  it("telefone com +55", () => {
    expect(normalizePixKey("(11) 91234-5678")).toBe("+5511912345678");
    expect(normalizePixKey("(11) 3456-7890")).toBe("+551134567890");
    expect(normalizePixKey("+55 19 99793-9514")).toBe("+5519997939514");
  });
  it("ambiguidade conhecida: celular de 11 dígitos que também é um CPF válido sai como CPF (use +55 na chave)", () => {
    expect(normalizePixKey("(19) 99793-9514")).toBe("19997939514");
    expect(normalizePixKey("+5519997939514")).toBe("+5519997939514");
  });
  it("e-mail e chave aleatória em minúsculas", () => {
    expect(normalizePixKey(" Pix@Estudio.COM ")).toBe("pix@estudio.com");
    expect(normalizePixKey("123E4567-E89B-12D3-A456-426614174000")).toBe("123e4567-e89b-12d3-a456-426614174000");
  });
});
