import type { MetadataRoute } from "next";
import { getBusiness } from "@/lib/server/db";
import { DEFAULT_THEME } from "@/lib/theme";

export const dynamic = "force-dynamic";

// PWA: o site pode ser instalado no celular. Instalado (Android/Chrome), ele aparece na lista
// "Compartilhar" do app do banco; o arquivo chega em /compartilhar/receber (tratado pelo public/sw.js).
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const b = await getBusiness().catch(() => null);
  const name = b?.name || "Agenda do Estúdio";
  const v = b?.logoVersion ?? 0;
  const icon = (size: number, purpose: "any" | "maskable") => ({
    src: `/api/public/app-icon?size=${size}&purpose=${purpose}&v=${v}`,
    sizes: `${size}x${size}`,
    type: "image/png",
    purpose,
  });
  return {
    id: "/",
    name,
    short_name: name.length > 20 ? name.slice(0, 20).trim() : name,
    description: "Agende seu horário e envie o comprovante do sinal.",
    lang: "pt-BR",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: b?.themeLightBg ?? DEFAULT_THEME.themeLightBg,
    theme_color: b?.themePrimary ?? DEFAULT_THEME.themePrimary,
    icons: [icon(192, "any"), icon(512, "any"), icon(512, "maskable")],
    share_target: {
      action: "/compartilhar/receber",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "title",
        text: "text",
        url: "url",
        files: [{ name: "file", accept: ["image/*", "application/pdf", ".pdf", ".png", ".jpg", ".jpeg"] }],
      },
    },
  };
}
