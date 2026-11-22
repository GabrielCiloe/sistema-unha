"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";

// Topo das telas de acesso (login, recuperar e redefinir senha): a mesma logo da tela da cliente
// (BrandHeader): 350 px, centralizada, sem moldura.
export function LoginBrand({ subtitle }: { subtitle: string }) {
  const [brand, setBrand] = useState<{ name: string; logoUrl: string | null } | null>(null);

  useEffect(() => {
    api<{ business: { name: string; logoUrl: string | null } }>("/api/public/info").then((r) => setBrand(r.business)).catch(() => {});
  }, []);

  return (
    <div className="mb-8 flex flex-col items-center gap-3 text-center">
      {brand?.logoUrl ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={brand.logoUrl} alt={`Logo de ${brand.name}`} className="mx-auto h-auto w-[350px] max-w-full object-contain" />
          <h1 className="sr-only">{brand.name}</h1>
        </>
      ) : (
        <h1 className="text-3xl font-semibold text-accent">{brand?.name ?? "Painel do estúdio"}</h1>
      )}
      <p className="text-xs text-muted">{subtitle}</p>
    </div>
  );
}
