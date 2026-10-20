import { requireUser } from "@/lib/server/auth";
import { db, getBusiness } from "@/lib/server/db";
import { handle, HttpError, json } from "@/lib/server/http";
import { sniffImage, toWebp } from "@/lib/server/images";

const MAX = 5 * 1024 * 1024; // entrada; o que fica salvo é o WebP reduzido

function kindOf(req: Request) {
  const k = new URL(req.url).searchParams.get("kind");
  if (k !== "desktop" && k !== "mobile") throw new HttpError(400, "Tipo de imagem inválido.");
  return k;
}
const flag = (k: "desktop" | "mobile", v: boolean) => (k === "desktop" ? { hasCoverDesktop: v } : { hasCoverMobile: v });

export const POST = handle(async (req) => {
  await requireUser();
  const kind = kindOf(req);
  const file = (await req.formData()).get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Selecione uma imagem.");
  if (file.size > MAX) throw new HttpError(413, "A imagem deve ter até 5 MB.");
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = sniffImage(buf);
  if (!mime) throw new HttpError(415, "Envie PNG, JPG ou WebP.");
  const webp = await toWebp(buf, kind === "desktop" ? { maxWidth: 1920, maxHeight: 1080 } : { maxWidth: 1080, maxHeight: 1920 });
  if (!webp) throw new HttpError(415, "Não foi possível processar a imagem.");
  await getBusiness();
  const row = { data: webp, mime: "image/webp" };
  await db.$transaction([
    db.businessCover.upsert({ where: { id: kind }, update: row, create: { id: kind, ...row } }),
    db.business.update({ where: { id: "main" }, data: { coverVersion: { increment: 1 }, ...flag(kind, true) } }),
  ]);
  return json({ ok: true });
});

export const DELETE = handle(async (req) => {
  await requireUser();
  const kind = kindOf(req);
  await getBusiness();
  await db.$transaction([
    db.businessCover.deleteMany({ where: { id: kind } }),
    db.business.update({ where: { id: "main" }, data: { coverVersion: { increment: 1 }, ...flag(kind, false) } }),
  ]);
  return json({ ok: true });
});
