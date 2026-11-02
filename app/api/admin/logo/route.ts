import { requireUser } from "@/lib/server/auth";
import { db, getBusiness } from "@/lib/server/db";
import { handle, HttpError, json } from "@/lib/server/http";
import { sniffImage } from "@/lib/server/images";

const MAX = 2 * 1024 * 1024; // a logo é guardada como foi enviada (sem conversão nem compressão)

export const POST = handle(async (req) => {
  await requireUser();
  const file = (await req.formData()).get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Selecione uma imagem.");
  if (file.size > MAX) throw new HttpError(413, "A logo deve ter até 2 MB.");
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = sniffImage(buf);
  if (!mime) throw new HttpError(415, "Envie PNG, JPG ou WebP.");
  await getBusiness();
  const row = { data: buf, mime };
  await db.$transaction([
    db.businessLogo.upsert({ where: { id: "main" }, update: row, create: { id: "main", ...row } }),
    db.business.update({ where: { id: "main" }, data: { logoVersion: { increment: 1 }, hasLogo: true } }),
  ]);
  return json({ ok: true });
});

export const DELETE = handle(async () => {
  await requireUser();
  await getBusiness();
  await db.$transaction([
    db.businessLogo.deleteMany(),
    db.business.update({ where: { id: "main" }, data: { logoVersion: { increment: 1 }, hasLogo: false } }),
  ]);
  return json({ ok: true });
});
