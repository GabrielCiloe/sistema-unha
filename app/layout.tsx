import type { Metadata, Viewport } from "next";
import { MODE_SCRIPT } from "@/components/theme-toggle";
import { getBusiness } from "@/lib/server/db";
import { DEFAULT_THEME, themeCss } from "@/lib/theme";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Agenda do Estúdio",
  description: "Agendamento online com confirmação por WhatsApp e pagamento do sinal via Pix.",
  robots: { index: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0f0c1b" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Cores da Personalização valem para o projeto todo, nos dois modos. Sem banco, cai no tema padrão.
  const theme = await getBusiness().catch(() => DEFAULT_THEME);
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: themeCss(theme) }} />
        <script dangerouslySetInnerHTML={{ __html: MODE_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
