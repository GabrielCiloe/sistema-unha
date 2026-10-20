import { requireUser } from "@/lib/server/auth";
import { db, getBusiness } from "@/lib/server/db";
import { handle, HttpError, json } from "@/lib/server/http";
import { sniffImage, toWebp } from "@/lib/server/images";

const MAX = 5 * 1024 * 1024; // entrada; o que fica salvo é o WebP reduzido

export const POST = handle(async (req) => {
  await requireUser();
  const file = (await req.formData()).get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Selecione uma imagem.");
  if (file.size > MAX) throw new HttpError(413, "A imagem deve ter até 5 MB.");
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = sniffImage(buf);
  if (!mime) throw new HttpError(415, "Envie PNG, JPG ou WebP.");
  const webp = await toWebp(buf, { maxWidth: 512, maxHeight: 512 });
  if (!webp) throw new HttpError(415, "Não foi possível processar a imagem.");
  await getBusiness();
  const row = { data: webp, mime: "image/webp" };
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
