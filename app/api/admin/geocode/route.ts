import { requireUser } from "@/lib/server/auth";
import { handle, HttpError, json } from "@/lib/server/http";

// Configurações > mapa > "Localizar endereço". Busca no OpenStreetMap (Nominatim) pelo servidor, que exige
// identificação do programa (User-Agent); tenta o endereço completo e depois sem o número.
export const dynamic = "force-dynamic";
const UA = "sistema-unha/1.0 (agenda de estudio; contato pelo painel)";

async function search(q: string) {
  const u = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({ format: "json", limit: "1", countrycodes: "br", q })}`;
  const r = await fetch(u, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new HttpError(502, "O serviço de mapas não respondeu. Tente de novo em instantes.");
  const hits = (await r.json()) as { lat: string; lon: string; display_name: string }[];
  return hits[0] ?? null;
}

export const GET = handle(async (req) => {
  await requireUser();
  const url = new URL(req.url);
  const address = (url.searchParams.get("address") ?? "").trim();
  const city = (url.searchParams.get("city") ?? "").trim();
  if (!address) throw new HttpError(400, "Informe o endereço.");
  const full = city ? `${address}, ${city}` : address;
  const noNumber = full.replace(/,?\s*\d+[a-zA-Z]?\b/, ""); // "Rua X, 123, Bairro" -> "Rua X, Bairro"
  const hit = (await search(full)) ?? (noNumber !== full ? await search(noNumber) : null);
  if (!hit) return json({ found: false });
  return json({ found: true, lat: Number(hit.lat), lng: Number(hit.lon), label: hit.display_name });
});
