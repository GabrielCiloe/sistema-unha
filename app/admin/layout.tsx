import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { currentUser } from "@/lib/server/auth";
import { getBusiness } from "@/lib/server/db";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const b = await getBusiness();
  const logoUrl = b.hasLogo ? `/api/public/logo?v=${b.logoVersion}` : null;
  return (
    <AdminShell userName={user.name} businessName={b.name} logoUrl={logoUrl}>
      {children}
    </AdminShell>
  );
}
