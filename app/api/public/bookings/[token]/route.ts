import { db, getBusiness } from "@/lib/server/db";
import { handle, HttpError, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req, ctx) => {
  const { token } = await ctx.params;
  const a = await db.appointment.findUnique({
    where: { publicToken: token },
    include: { items: true, customer: true, payments: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!a) throw new HttpError(404, "Reserva não encontrada.");
  const biz = await getBusiness();
  const p = a.payments[0];
  return json({
    business: { name: biz.name, address: biz.address },
    appointment: {
      status: a.status,
      startsAt: a.startsAt,
      totalCents: a.totalCents,
      depositCents: a.depositCents,
      customerName: a.customer.name.split(" ")[0],
      items: a.items.map((i) => ({ name: i.name, priceCents: i.priceCents })),
    },
    payment: p && {
      id: p.id,
      status: p.status,
      amountCents: p.amountCents,
      pixPayload: p.pixPayload,
      rejectReason: p.rejectReason,
    },
  });
});
