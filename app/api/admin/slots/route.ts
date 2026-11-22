import { requireUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { handle, HttpError, json } from "@/lib/server/http";
import { availableSlots, loadBiz, reasonMessage } from "@/lib/server/slots";

// Agendamento interno: horários do dia para os serviços escolhidos. Mesma grade da página pública (availableSlots),
// mas sem a antecedência mínima em dias: a dona pode agendar para hoje. Ocupado e dia fechado continuam fora.
export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  await requireUser();
  const url = new URL(req.url);
  const date = url.searchParams.get("date") ?? "";
  const ids = (url.searchParams.get("serviceIds") ?? "").split(",").filter(Boolean);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || ids.length === 0) throw new HttpError(400, "Parâmetros inválidos.");
  const services = await db.service.findMany({ where: { id: { in: ids }, active: true, deletedAt: null } });
  if (services.length !== ids.length) throw new HttpError(400, "Serviço indisponível.");
  const duration = services.reduce((s, x) => s + x.durationMin, 0);
  const { slots, reason } = await availableSlots(date, duration, { ignoreLead: true });
  const biz = await loadBiz();
  return json({
    slots,
    durationMin: duration,
    reason,
    message: reason && biz ? reasonMessage(reason, duration, { ...biz, minLeadDays: 0 }) : null,
  });
});
