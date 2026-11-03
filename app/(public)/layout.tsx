import { InstallFab } from "@/components/pwa";
import { ThemeToggle } from "@/components/theme-toggle";

export const dynamic = "force-dynamic";

// Páginas voltadas à cliente (e login): cores da marca (Admin → Personalização) nos dois modos,
// com o alternador claro/escuro e luzes de fundo nas cores da marca.
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative isolate min-h-screen bg-background text-ink">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 70% 50% at 10% 0%, color-mix(in srgb, var(--color-brand) 22%, transparent), transparent 60%), radial-gradient(ellipse 60% 45% at 95% 15%, color-mix(in srgb, var(--color-accent) 18%, transparent), transparent 60%), radial-gradient(ellipse 60% 40% at 50% 100%, color-mix(in srgb, var(--color-brand) 12%, transparent), transparent 65%)",
        }}
      />
      <ThemeToggle className="fixed right-4 top-4 z-30" />
      {children}
      <InstallFab />
    </div>
  );
}
