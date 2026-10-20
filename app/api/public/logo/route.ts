import { db } from "@/lib/server/db";

export const dynamic = "force-dynamic";

// Logo pública do estúdio. O parâmetro ?v=<logoVersion> permite cache longo e invalida ao trocar a imagem.
export async function GET() {
  const logo = await db.businessLogo.findUnique({ where: { id: "main" } });
  if (!logo) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(logo.data), {
    headers: {
      "Content-Type": logo.mime,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      // Imagem nunca executa script, mesmo se aberta diretamente.
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; sandbox",
    },
  });
}
