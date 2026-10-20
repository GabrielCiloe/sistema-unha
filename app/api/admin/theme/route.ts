import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { db, getBusiness } from "@/lib/server/db";
import { handle, HttpError, json } from "@/lib/server/http";
import { DEFAULT_THEME, HEX, themeProblems } from "@/lib/theme";

const hex = z.string().regex(HEX, "Cor inválida (use #RRGGBB).");
const schema = z.object({
  tagline: z.string().trim().max(120),
  themeBg: hex,
  themeSurface: hex,
  themeText: hex,
  themePrimary: hex,
  themeAccent: hex,
  themeConfirm: hex,
  themeLightBg: hex,
  themeLightSurface: hex,
  themeLightText: hex,
});

export const GET = handle(async () => {
  await requireUser();
  const b = await getBusiness();
  return json({
    name: b.name,
    tagline: b.tagline,
    logoVersion: b.logoVersion,
    hasLogo: b.hasLogo,
    coverVersion: b.coverVersion,
    hasCoverDesktop: b.hasCoverDesktop,
    hasCoverMobile: b.hasCoverMobile,
    theme: {
      themeBg: b.themeBg, themeSurface: b.themeSurface, themeText: b.themeText,
      themePrimary: b.themePrimary, themeAccent: b.themeAccent, themeConfirm: b.themeConfirm,
      themeLightBg: b.themeLightBg ?? DEFAULT_THEME.themeLightBg, themeLightSurface: b.themeLightSurface ?? DEFAULT_THEME.themeLightSurface, themeLightText: b.themeLightText ?? DEFAULT_THEME.themeLightText,
    },
    defaults: DEFAULT_THEME,
  });
});

export const PUT = handle(async (req) => {
  await requireUser();
  const data = schema.parse(await req.json());
  const problems = themeProblems(data);
  if (problems.length) throw new HttpError(400, problems.join(" "));
  await getBusiness();
  await db.business.update({ where: { id: "main" }, data });
  return json({ ok: true });
});
