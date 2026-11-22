import { describe, expect, it } from "vitest";
import { bookingLines, bookingTotals, depositCentsFor, missingNailsFor } from "@/lib/booking-math";

const manicure = { id: "man", name: "Manicure", priceCents: 4500, durationMin: 45, missingNailPriceCents: 0 };
const manutencao = { id: "manut", name: "Manutenção em gel", priceCents: 12000, durationMin: 90, missingNailPriceCents: 1500 };

describe("depositCentsFor (sinal)", () => {
  it("aplica o percentual do estúdio", () => {
    expect(depositCentsFor(4500, 30)).toBe(1350);
    expect(depositCentsFor(10000, 50)).toBe(5000);
    expect(depositCentsFor(12345, 100)).toBe(12345);
    expect(depositCentsFor(10000, 10)).toBe(1000);
  });

  it("arredonda ao centavo mais próximo (meio centavo sobe)", () => {
    expect(depositCentsFor(3333, 30)).toBe(1000); // 999,9
    expect(depositCentsFor(3334, 30)).toBe(1000); // 1000,2
    expect(depositCentsFor(1005, 50)).toBe(503); // 502,5
    expect(depositCentsFor(101, 33)).toBe(33); // 33,33
    expect(depositCentsFor(4990, 15)).toBe(749); // 748,5
  });

  it("nunca fica abaixo de 1 centavo", () => {
    expect(depositCentsFor(1, 10)).toBe(1); // 0,1
    expect(depositCentsFor(4, 10)).toBe(1); // 0,4
    expect(depositCentsFor(0, 30)).toBe(1);
  });

  it("devolve sempre um inteiro", () => {
    for (let total = 100; total < 20_000; total += 137) for (const pct of [10, 15, 30, 33, 50, 100]) expect(Number.isInteger(depositCentsFor(total, pct))).toBe(true);
  });
});

describe("unhas faltando", () => {
  it("só conta em serviço com preço por unha", () => {
    expect(missingNailsFor(manicure, { man: 3 })).toBe(0);
    expect(missingNailsFor(manutencao, { manut: 3 })).toBe(3);
  });

  it("sem informação é zero; limita a 0..10 e descarta fração", () => {
    expect(missingNailsFor(manutencao)).toBe(0);
    expect(missingNailsFor(manutencao, {})).toBe(0);
    expect(missingNailsFor(manutencao, { outro: 4 })).toBe(0);
    expect(missingNailsFor(manutencao, { manut: -2 })).toBe(0);
    expect(missingNailsFor(manutencao, { manut: 25 })).toBe(10);
    expect(missingNailsFor(manutencao, { manut: 2.9 })).toBe(2);
  });

  it("soma o preço por unha à linha e descreve no nome", () => {
    const [a, b] = bookingLines([manicure, manutencao], { manut: 2, man: 5 });
    expect(a).toMatchObject({ missing: 0, priceCents: 4500, name: "Manicure" });
    expect(b).toMatchObject({ missing: 2, priceCents: 15000, name: "Manutenção em gel (2 unhas faltando)" });
    expect(bookingLines([manutencao], { manut: 1 })[0].name).toBe("Manutenção em gel (1 unha faltando)");
  });
});

describe("bookingTotals", () => {
  it("total, duração e sinal de um serviço simples", () => {
    expect(bookingTotals([manicure], 30)).toMatchObject({ totalCents: 4500, durationMin: 45, depositCents: 1350 });
  });

  it("as unhas faltando entram no total e, por consequência, no sinal (mas não na duração)", () => {
    const sem = bookingTotals([manicure, manutencao], 30);
    const com = bookingTotals([manicure, manutencao], 30, { manut: 3 });
    expect(sem).toMatchObject({ totalCents: 16500, durationMin: 135, depositCents: 4950 });
    expect(com).toMatchObject({ totalCents: 21000, durationMin: 135, depositCents: 6300 });
  });

  it("o sinal é calculado sobre o total, não somado linha a linha", () => {
    const a = { ...manicure, id: "a", priceCents: 1005 };
    const b = { ...manicure, id: "b", priceCents: 1005 };
    expect(bookingTotals([a, b], 50).depositCents).toBe(1005); // 502,5 + 502,5 arredondados separadamente dariam 1006
  });
});
