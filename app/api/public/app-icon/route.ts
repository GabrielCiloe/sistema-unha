import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { db, getBusiness } from "@/lib/server/db";
import { DEFAULT_THEME } from "@/lib/theme";

export const dynamic = "force-dynamic";

// Ícone do app instalado (PWA): a logo do estúdio centralizada num quadrado com o fundo claro da marca.
// "maskable" ganha mais margem, porque o Android recorta o ícone em círculo/gota.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const size = q.get("size") === "512" ? 512 : 192;
  const maskable = q.get("purpose") === "maskable";
  const [b, logo] = await Promise.all([getBusiness().catch(() => null), db.businessLogo.findUnique({ where: { id: "main" } }).catch(() => null)]);
  const bg = b?.themeLightBg ?? DEFAULT_THEME.themeLightBg;

  let src: Buffer | null = logo ? Buffer.from(logo.data) : null;
  if (!src) src = await readFile(path.join(process.cwd(), "public", "logo-fernanda-nail.png")).catch(() => null);

  const inner = Math.round(size * (maskable ? 0.62 : 0.84));
  const canvas = sharp({ create: { width: size, height: size, channels: 4, background: bg } });
  let png: Buffer;
  try {
    const layers = src
      ? [{ input: await sharp(src, { limitInputPixels: 40_000_000 }).resize({ width: inner, height: inner, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer(), gravity: "center" }]
      : [];
    png = await canvas.composite(layers).png().toBuffer();
  } catch {
    png = await canvas.png().toBuffer();
  }
  return new Response(new Uint8Array(png), {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" },
  });
}
