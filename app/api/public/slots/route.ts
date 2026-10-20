import { db } from "@/lib/server/db";
import { handle, HttpError, json } from "@/lib/server/http";
import { availableSlots, loadBiz, reasonMessage } from "@/lib/server/slots";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const url = new URL(req.url);
  const date = url.searchParams.get("date") ?? "";
  const ids = (url.searchParams.get("serviceIds") ?? "").split(",").filter(Boolean);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || ids.length === 0) throw new HttpError(400, "Parâmetros inválidos.");
  const services = await db.service.findMany({ where: { id: { in: ids }, active: true, deletedAt: null } });
  if (services.length !== ids.length) throw new HttpError(400, "Serviço indisponível.");
  const duration = services.reduce((s, x) => s + x.durationMin, 0);
  const { slots, reason } = await availableSlots(date, duration);
  const biz = await loadBiz();
  return json({
    slots,
    durationMin: duration,
    reason,
    message: reason && biz ? reasonMessage(reason, duration, biz) : null,
  });
});
