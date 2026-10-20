import { db, getBusiness } from "@/lib/server/db";
import { handle, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const [b, services] = await Promise.all([
    getBusiness(),
    db.service.findMany({ where: { active: true, deletedAt: null }, orderBy: { name: "asc" } }),
  ]);
  return json({
    business: {
      name: b.name, address: b.address, depositPercent: b.depositPercent, workDays: b.workDays,
      tagline: b.tagline, logoUrl: b.hasLogo ? `/api/public/logo?v=${b.logoVersion}` : null,
      // Se só existir uma das imagens de fundo, ela vale para desktop e celular.
      coverDesktopUrl: b.hasCoverDesktop || b.hasCoverMobile ? `/api/public/cover?kind=${b.hasCoverDesktop ? "desktop" : "mobile"}&v=${b.coverVersion}` : null,
      coverMobileUrl: b.hasCoverDesktop || b.hasCoverMobile ? `/api/public/cover?kind=${b.hasCoverMobile ? "mobile" : "desktop"}&v=${b.coverVersion}` : null,
    },
    services: services.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      durationMin: s.durationMin,
      priceCents: s.priceCents,
    })),
  });
});
