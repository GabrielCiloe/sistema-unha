import { requireUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { settlePastAppointments } from "@/lib/server/appointments";
import { handle, HttpError, json } from "@/lib/server/http";

export const GET = handle(async (req) => {
  await requireUser();
  const url = new URL(req.url);
  const from = new Date(url.searchParams.get("from") ?? Date.now() - 7 * 86400_000);
  const to = new Date(url.searchParams.get("to") ?? Date.now() + 60 * 86400_000);
  if (isNaN(+from) || isNaN(+to)) throw new HttpError(400, "Período inválido.");
  await settlePastAppointments();
  const status = url.searchParams.get("status");
  const appointments = await db.appointment.findMany({
    where: { startsAt: { gte: from, lte: to }, ...(status ? { status: status as never } : {}) },
    orderBy: { startsAt: "asc" },
    take: 500,
    include: {
      customer: true,
      items: true,
      payments: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true, status: true, amountCents: true, paidAt: true,
          rejectReason: true, proofMime: true,
        },
      },
    },
  });
  return json({ appointments });
});
