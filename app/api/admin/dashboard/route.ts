import { requireUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { settlePastAppointments } from "@/lib/server/appointments";
import { handle, json } from "@/lib/server/http";
import { localToDate } from "@/lib/server/slots";

export const GET = handle(async () => {
  await requireUser();
  await settlePastAppointments();
  const now = new Date();
  const todayStr = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(now);
  const dayStart = localToDate(todayStr, 0);
  const dayEnd = localToDate(todayStr, 1440);
  const monthStart = localToDate(todayStr.slice(0, 8) + "01", 0);

  const [today, upcoming, inReview, paidMonth, customers, pendingToday] = await Promise.all([
    db.appointment.count({ where: { startsAt: { gte: dayStart, lt: dayEnd }, status: { in: ["CONFIRMED", "COMPLETED"] } } }),
    db.appointment.findMany({
      where: { startsAt: { gte: now }, status: "CONFIRMED" },
      orderBy: { startsAt: "asc" },
      take: 6,
      include: { customer: true, items: true },
    }),
    db.payment.count({ where: { status: "IN_REVIEW" } }),
    db.payment.aggregate({ _sum: { amountCents: true }, where: { status: "PAID", paidAt: { gte: monthStart } } }),
    db.customer.count(),
    db.appointment.count({ where: { startsAt: { gte: dayStart, lt: dayEnd }, status: "PENDING_PAYMENT" } }),
  ]);
  return json({
    today,
    pendingToday,
    inReview,
    customers,
    monthRevenueCents: paidMonth._sum.amountCents ?? 0,
    upcoming,
  });
});
