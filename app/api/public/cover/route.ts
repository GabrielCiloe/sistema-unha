import { db } from "@/lib/server/db";

export const dynamic = "force-dynamic";

// Imagem de fundo do topo (?kind=desktop|mobile). ?v=<coverVersion> permite cache longo e invalida ao trocar.
export async function GET(req: Request) {
  const kind = new URL(req.url).searchParams.get("kind");
  if (kind !== "desktop" && kind !== "mobile") return new Response(null, { status: 404 });
  const cover = await db.businessCover.findUnique({ where: { id: kind } });
  if (!cover) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(cover.data), {
    headers: {
      "Content-Type": cover.mime,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; sandbox",
    },
  });
}
