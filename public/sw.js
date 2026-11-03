// Service worker do app instalado (PWA).
// Única função: receber o comprovante compartilhado pelo app do banco ("Compartilhar" → app do estúdio).
// O Android envia um POST multipart para /compartilhar/receber; o arquivo fica guardado no cache e a
// página /compartilhar (que sabe qual é a reserva) faz o envio. Demais requisições seguem direto para a rede.
const SHARE_CACHE = "compartilhar-v1";
const FILE_KEY = "/compartilhar/arquivo";
const META_KEY = "/compartilhar/info";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || url.origin !== self.location.origin || url.pathname !== "/compartilhar/receber") return;

  event.respondWith(
    (async () => {
      const go = (q) => Response.redirect(new URL("/compartilhar" + q, self.location.origin).href, 303);
      try {
        const form = await event.request.formData();
        const file = form.getAll("file").find((f) => typeof f === "object" && f && "size" in f && f.size > 0);
        const cache = await caches.open(SHARE_CACHE);
        await Promise.all([cache.delete(FILE_KEY), cache.delete(META_KEY)]);
        const meta = {
          name: file ? file.name || "comprovante" : "",
          type: file ? file.type || "" : "",
          text: [form.get("title"), form.get("text"), form.get("url")].filter((v) => typeof v === "string" && v).join(" "),
          at: Date.now(),
        };
        if (file) await cache.put(FILE_KEY, new Response(file, { headers: { "Content-Type": meta.type || "application/octet-stream" } }));
        await cache.put(META_KEY, new Response(JSON.stringify(meta), { headers: { "Content-Type": "application/json" } }));
        return go(file ? "" : "?sem-arquivo=1");
      } catch {
        return go("?erro=1");
      }
    })(),
  );
});
