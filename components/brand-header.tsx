// Topo das páginas públicas (Figma "Cliente"): logo de 350 px, centralizada, sem moldura,
// 80 px acima e 50 px até o primeiro cartão. Sem logo enviada, mostra o nome do estúdio.
export function BrandHeader({ name, logoUrl, tagline }: { name: string; logoUrl: string | null; tagline?: string }) {
  return (
    <header className="px-5 pb-[50px] pt-[80px] text-center">
      {logoUrl ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoUrl} alt={`Logo de ${name}`} className="mx-auto h-auto w-[350px] max-w-full object-contain" />
          <h1 className="sr-only">{name}</h1>
        </>
      ) : (
        <h1 className="text-3xl font-semibold text-accent">{name}</h1>
      )}
      {tagline && <p className="mx-auto mt-3 max-w-md text-sm text-muted">{tagline}</p>}
    </header>
  );
}
