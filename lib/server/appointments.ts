import { db } from "./db";

// "Concluído" = agendamento confirmado cujo horário já terminou. Aplicado ao ler a agenda e pelo cron.
export async function settlePastAppointments() {
  const r = await db.appointment.updateMany({
    where: { status: "CONFIRMED", endsAt: { lt: new Date() } },
    data: { status: "COMPLETED" },
  });
  return r.count;
}
