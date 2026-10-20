import { ThemeToggle } from "@/components/theme-toggle";

export const dynamic = "force-dynamic";

// Páginas voltadas ao cliente (e login). As cores (Admin → Personalização) vêm do layout raiz, nos dois modos.
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen bg-background text-ink">
      <ThemeToggle className="absolute right-4 top-4 z-30" />
      {children}
    </div>
  );
}
