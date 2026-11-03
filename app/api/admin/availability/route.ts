import { requireUser } from "@/lib/server/auth";
import { handle, HttpError, json } from "@/lib/server/http";
import { freePeriods } from "@/lib/server/slots";

// Agenda > popup do dia > "Ver horários disponíveis": períodos livres do expediente naquele dia.
export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  await requireUser();
  const date = new URL(req.url).searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "Data inválida.");
  return json(await freePeriods(date));
});
