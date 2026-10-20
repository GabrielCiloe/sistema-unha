import { db } from "@/lib/server/db";
import { handle, HttpError, json } from "@/lib/server/http";
import { availabilityForDays, reasonMessage } from "@/lib/server/slots";

export const dynamic = "force-dynamic";

const addDays = (s: string, n: number) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

// Disponibilidade dos próximos dias para os serviços escolhidos (a tela cinza os dias sem horário).
export const GET = handle(async (req) => {
  const url = new URL(req.url);
  const ids = (url.searchParams.get("serviceIds") ?? "").split(",").filter(Boolean);
  const count = Math.min(Math.max(Number(url.searchParams.get("days") ?? 21), 1), 60);
  if (ids.length === 0) throw new HttpError(400, "Escolha ao menos um serviço.");
  const services = await db.service.findMany({ where: { id: { in: ids }, active: true, deletedAt: null } });
  if (services.length !== ids.length) throw new HttpError(400, "Serviço indisponível.");
  const duration = services.reduce((s, x) => s + x.durationMin, 0);

  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const dates = Array.from({ length: count }, (_, i) => addDays(today, i));
  const { biz, days } = await availabilityForDays(dates, duration);
  return json({
    durationMin: duration,
    days: days.map((d) => ({
      date: d.date,
      available: d.count > 0,
      count: d.count,
      reason: d.reason,
      message: d.reason && biz ? reasonMessage(d.reason, duration, biz) : null,
    })),
  });
});
