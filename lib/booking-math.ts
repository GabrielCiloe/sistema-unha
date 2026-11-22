// Contas da reserva (funções puras): linhas por serviço, total, duração e sinal. Usadas por createBooking.
import { MAX_MISSING_NAILS } from "./validation";

export type PricedService = { id: string; name: string; priceCents: number; durationMin: number; missingNailPriceCents: number };

// Unhas faltando que valem para o serviço: só em serviço com preço por unha, inteiro entre 0 e MAX_MISSING_NAILS.
export function missingNailsFor(service: Pick<PricedService, "id" | "missingNailPriceCents">, missingNails?: Record<string, number>) {
  return service.missingNailPriceCents > 0 ? Math.max(0, Math.min(MAX_MISSING_NAILS, Math.floor(missingNails?.[service.id] ?? 0))) : 0;
}

// Manutenção: cada unha faltando soma o preço por unha do serviço ao total (e, por consequência, ao sinal).
export function bookingLines<S extends PricedService>(services: S[], missingNails?: Record<string, number>) {
  return services.map((s) => {
    const missing = missingNailsFor(s, missingNails);
    const extra = missing * s.missingNailPriceCents;
    return { s, missing, priceCents: s.priceCents + extra, name: missing > 0 ? `${s.name} (${missing} ${missing === 1 ? "unha faltando" : "unhas faltando"})` : s.name };
  });
}

// Sinal: percentual do total, arredondado ao centavo, nunca menos de 1 centavo.
export const depositCentsFor = (totalCents: number, depositPercent: number) => Math.max(1, Math.round((totalCents * depositPercent) / 100));

export function bookingTotals<S extends PricedService>(services: S[], depositPercent: number, missingNails?: Record<string, number>) {
  const lines = bookingLines(services, missingNails);
  const durationMin = services.reduce((s, x) => s + x.durationMin, 0);
  const totalCents = lines.reduce((s, x) => s + x.priceCents, 0);
  return { lines, durationMin, totalCents, depositCents: depositCentsFor(totalCents, depositPercent) };
}
