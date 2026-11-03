// Topo das páginas públicas (Figma "Cliente"): logo de 350 px, centralizada, sem moldura.
// Com banner enviado (Personalização), ele fica atrás da logo com um degradê por cima, nas cores do tema.
export function BrandHeader({ name, logoUrl, tagline, cover }: { name: string; logoUrl: string | null; tagline?: string; cover?: { desktop: string | null; mobile: string | null } }) {
  const hasCover = Boolean(cover?.desktop || cover?.mobile);
  return (
    <header
      className="relative isolate overflow-hidden px-5 pb-[50px] pt-[80px] text-center"
      style={hasCover ? ({ "--cover-m": `url(${cover!.mobile ?? cover!.desktop})`, "--cover-d": `url(${cover!.desktop ?? cover!.mobile})` } as React.CSSProperties) : undefined}
    >
      {hasCover && (
        <>
          {/* O banner se dissolve no fim (máscara), sem linha de emenda com o resto da página. */}
          <div aria-hidden className="absolute inset-0 -z-20 bg-[image:var(--cover-m)] bg-cover bg-center md:bg-[image:var(--cover-d)]" style={{ WebkitMaskImage: "linear-gradient(to bottom, black 45%, transparent 92%)", maskImage: "linear-gradient(to bottom, black 45%, transparent 92%)" }} />
          {/* Degradê linear por cima do banner: escurece/clareia com a cor de fundo e tinge com a marca. */}
          <div
            aria-hidden
            className="absolute inset-0 -z-10"
            style={{
              background:
                "linear-gradient(180deg, color-mix(in srgb, var(--color-background) 10%, transparent) 0%, color-mix(in srgb, color-mix(in srgb, var(--color-background) 52%, var(--color-brand)) 85%, transparent) 50%, color-mix(in srgb, var(--color-background) 60%, transparent) 80%, transparent 100%)",
            }}
          />
        </>
      )}
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
