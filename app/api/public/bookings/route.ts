import { createBooking } from "@/lib/server/bookings";
import { clientIp, handle, json, rateLimit } from "@/lib/server/http";
import { bookingSchema } from "@/lib/validation";

export const POST = handle(async (req) => {
  rateLimit(`book:${clientIp(req)}`, Number(process.env.BOOKING_RATE_LIMIT ?? 10), 10 * 60_000);
  const body = bookingSchema.parse(await req.json());
  const { appt, payment } = await createBooking({ ...body, startsAt: new Date(body.startsAt) });
  return json({ token: appt.publicToken, paymentStatus: payment.status }, 201);
});
