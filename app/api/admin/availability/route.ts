import { requireUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { handle, HttpError, json } from "@/lib/server/http";
import { addDays, availabilityForDays, freePeriods, reasonMessage, todayLocal } from "@/lib/server/slots";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  await requireUser();
  const url = new URL(req.url);
  const ids = (url.searchParams.get("serviceIds") ?? "").split(",").filter(Boolean);

  // Agendamento interno (?serviceIds=a,b&days=60): disponibilidade dos próximos dias para o calendário, como a rota
  // pública, mas a partir de HOJE e sem a antecedência mínima em dias. Dia fechado ou cheio continua indisponível.
  if (ids.length > 0) {
    const count = Math.min(Math.max(Number(url.searchParams.get("days") ?? 60) || 60, 1), 90);
    const services = await db.service.findMany({ where: { id: { in: ids }, active: true, deletedAt: null } });
    if (services.length !== ids.length) throw new HttpError(400, "Serviço indisponível.");
    const duration = services.reduce((s, x) => s + x.durationMin, 0);
    const today = todayLocal(Date.now());
    const { biz, days } = await availabilityForDays(Array.from({ length: count }, (_, i) => addDays(today, i)), duration, { ignoreLead: true });
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
  }

  // Agenda > popup do dia > "Ver horários disponíveis" (?date=AAAA-MM-DD): períodos livres do expediente naquele dia.
  const date = url.searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "Data inválida.");
  return json(await freePeriods(date));
});
