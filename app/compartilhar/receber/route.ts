// Alvo do "Compartilhar" do PWA. Normalmente o service worker (public/sw.js) intercepta este POST e guarda o
// arquivo; se ele ainda não estiver ativo, a requisição chega aqui e a cliente vai para a página com um aviso.
// Redirecionamento relativo: funciona igual atrás do túnel/proxy do Coolify.
const to = (location: string) => new Response(null, { status: 303, headers: { Location: location } });

export const POST = () => to("/compartilhar?erro=sw");
export const GET = () => to("/compartilhar");
