import { requireUser } from "@/lib/server/auth";
import { db, getBusiness } from "@/lib/server/db";
import { handle, HttpError, json } from "@/lib/server/http";
import { LOGO_MAX_BYTES, LOGO_MAX_SIDE, sniffImage, toWebp } from "@/lib/server/images";

// Limite do arquivo ENVIADO (LOGO_MAX_BYTES); o que fica salvo é um WebP reduzido, como a imagem de fundo.

export const POST = handle(async (req) => {
  await requireUser();
  const file = (await req.formData()).get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Selecione uma imagem.");
  if (file.size > LOGO_MAX_BYTES) throw new HttpError(413, "A logo deve ter até 5 MB.");
  const buf = Buffer.from(await file.arrayBuffer());
  if (!sniffImage(buf)) throw new HttpError(415, "Envie PNG, JPG ou WebP.");
  // Qualidade 90 (a imagem de fundo usa 80): logo tem bordas e letras finas, que perdem nitidez com mais compressão.
  const webp = await toWebp(buf, { maxWidth: LOGO_MAX_SIDE, maxHeight: LOGO_MAX_SIDE, quality: 90 });
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
