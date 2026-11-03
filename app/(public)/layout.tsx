import { InstallFab } from "@/components/pwa";
import { getBusiness } from "@/lib/server/db";
import { DEFAULT_THEME, themeVars } from "@/lib/theme";

export const dynamic = "force-dynamic";

// Páginas voltadas à cliente (e login): sempre no modo claro, com as cores da marca
// definidas em Admin → Personalização. O painel continua com o alternador escuro/claro.
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const theme = await getBusiness().catch(() => DEFAULT_THEME);
  return (
    <div className="public-light relative min-h-screen bg-background text-ink" style={{ ...themeVars(theme, "light"), colorScheme: "light" } as React.CSSProperties}>
      {children}
      <InstallFab />
    </div>
  );
}
