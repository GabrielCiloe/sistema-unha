"use client";

import { ImagePlus, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PageTitle } from "@/components/admin-shell";
import { toast } from "@/components/toast";
import { api, useApi } from "@/lib/client";
import { DEFAULT_THEME, HEX, themeProblems, themeVars, type Theme } from "@/lib/theme";
import { FormSkeleton } from "@/components/skeleton";

type Resp = { name: string; tagline: string; logoVersion: number; hasLogo: boolean; coverVersion: number; hasCoverDesktop: boolean; hasCoverMobile: boolean; theme: Theme; defaults: Theme };

type Field = { key: keyof Theme; label: string; hint: string };
const BRAND_FIELDS: Field[] = [
  { key: "themePrimary", label: "Botões principais", hint: "Cor única dos botões (ex.: Agendar horário)" },
  { key: "themeAccent", label: "Cor de destaque", hint: "Brilho do topo da página e pequenos detalhes" },
  { key: "themeConfirm", label: "Confirmação", hint: "Botão de reservar, comprovante e “confirmado”" },
];
const DARK_FIELDS: Field[] = [
  { key: "themeBg", label: "Fundo da página", hint: "Cor atrás de tudo" },
  { key: "themeSurface", label: "Cartões", hint: "Caixas de serviços e dados" },
  { key: "themeText", label: "Texto", hint: "Títulos e parágrafos" },
];
const LIGHT_FIELDS: Field[] = [
  { key: "themeLightBg", label: "Fundo da página (claro)", hint: "Cor atrás de tudo" },
  { key: "themeLightSurface", label: "Cartões (claro)", hint: "Caixas de serviços e dados" },
  { key: "themeLightText", label: "Texto (claro)", hint: "Títulos e parágrafos" },
];
const COVERS = [
  { kind: "desktop", title: "Desktop", hint: "Horizontal, ex.: 1920×800. PNG, JPG ou WebP, até 5 MB.", has: (d: Resp) => d.hasCoverDesktop },
  { kind: "mobile", title: "Celular", hint: "Vertical, ex.: 900×1400. PNG, JPG ou WebP, até 5 MB.", has: (d: Resp) => d.hasCoverMobile },
] as const;

const LIGHT = { themeLightBg: DEFAULT_THEME.themeLightBg, themeLightSurface: DEFAULT_THEME.themeLightSurface, themeLightText: DEFAULT_THEME.themeLightText };
const PRESETS: { name: string; theme: Theme }[] = [
  { name: "Violeta", theme: DEFAULT_THEME },
  { name: "Rosé", theme: { ...LIGHT, themeBg: "#1c1014", themeSurface: "#2a181e", themeText: "#fff1f4", themePrimary: "#e11d68", themeAccent: "#fb7185", themeConfirm: "#34d399", themeLightBg: "#fff5f7", themeLightText: "#3a1a24" } },
  { name: "Preto e dourado", theme: { ...LIGHT, themeBg: "#0c0c0c", themeSurface: "#1a1814", themeText: "#f6efe0", themePrimary: "#8f6a16", themeAccent: "#c9a13b", themeConfirm: "#a8851f", themeLightBg: "#faf6ec", themeLightText: "#2a2417" } },
  { name: "Oceano", theme: { ...LIGHT, themeBg: "#0b1220", themeSurface: "#162033", themeText: "#f1f5f9", themePrimary: "#0369a1", themeAccent: "#22d3ee", themeConfirm: "#34d399", themeLightBg: "#f1f7fb", themeLightText: "#0f2233" } },
];

export default function Personalization() {
  const { data, loading, reload } = useApi<Resp>("/api/admin/theme");
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  const [tagline, setTagline] = useState("");
  const setMsg = (m: { ok: boolean; text: string } | null) => m && toast(m.text, m.ok);
  const [busy, setBusy] = useState(false);
  const [previewMode, setPreviewMode] = useState<"dark" | "light">("dark");
  const file = useRef<HTMLInputElement>(null);

  // Preenche o formulário só na 1ª carga: recarregar depois (ex.: ao enviar a logo) não pode apagar o que ainda não foi salvo.
  const initialized = useRef(false);
  useEffect(() => {
    if (data && !initialized.current) {
      initialized.current = true;
      setTheme({ ...DEFAULT_THEME, ...data.theme });
      setTagline(data.tagline);
    }
  }, [data]);

  if (loading || !data) return <FormSkeleton sections={2} />;

  const valid = (Object.values(theme) as string[]).every((c) => HEX.test(c));
  const problems = valid ? themeProblems(theme) : [];
  const logoUrl = data.hasLogo ? `/api/public/logo?v=${data.logoVersion}` : null;

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/admin/theme", { method: "PUT", body: { ...theme, tagline } });
      setMsg({ ok: true, text: "Personalização salva. Já aparece para as clientes." });
      reload();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Erro" });
    } finally {
      setBusy(false);
    }
  }

  async function upload(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      await api("/api/admin/logo", { method: "POST", body: fd });
      setMsg({ ok: true, text: "Logo atualizada." });
      reload();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Erro" });
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  }

  async function uploadCover(kind: "desktop" | "mobile", f: File | undefined) {
    if (!f) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      await api(`/api/admin/cover?kind=${kind}`, { method: "POST", body: fd });
      setMsg({ ok: true, text: "Imagem de fundo atualizada." });
      reload();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Erro" });
    } finally {
      setBusy(false);
    }
  }

  async function removeCover(kind: "desktop" | "mobile") {
    if (!confirm("Remover esta imagem de fundo?")) return;
    await api(`/api/admin/cover?kind=${kind}`, { method: "DELETE" });
    reload();
  }

  async function removeLogo() {
    if (!confirm("Remover a logo?")) return;
    await api("/api/admin/logo", { method: "DELETE" });
    reload();
  }

  return (
    <>
      <PageTitle title="Personalização" />
      <div className="has-actionbar grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-6">
          <section className="card">
            <h2 className="mb-4 font-semibold">Logo e frase de apresentação</h2>
            <div className="flex flex-wrap items-center gap-5">
              <div
                role={logoUrl ? "img" : undefined}
                aria-label={logoUrl ? "Logo atual" : undefined}
                className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-line bg-background bg-cover bg-center"
                style={logoUrl ? { backgroundImage: `url(${logoUrl})` } : undefined}
              >
                {!logoUrl && <Sparkles className="text-muted" />}
              </div>
              <div className="space-y-2">
                <input ref={file} id="logo-file" type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => upload(e.target.files?.[0])} />
                <div className="flex flex-wrap gap-2">
                  <label htmlFor="logo-file" className="btn-ghost cursor-pointer"><ImagePlus size={15} /> {logoUrl ? "Trocar logo" : "Enviar logo"}</label>
                  {logoUrl && <button className="btn-danger" onClick={removeLogo}><Trash2 size={15} /> Remover</button>}
                </div>
                <p className="text-xs text-muted">PNG, JPG ou WebP, até 5 MB (convertida para WebP automaticamente). Quadrada ou com fundo transparente fica melhor.</p>
              </div>
            </div>
            <div className="mt-5">
              <label className="label" htmlFor="tagline">Frase de apresentação (aparece abaixo do nome)</label>
              <input id="tagline" className="input" maxLength={120} placeholder="Ex.: Unhas de gel, nail art e cuidado com carinho" value={tagline} onChange={(e) => setTagline(e.target.value)} />
            </div>
          </section>

          <section className="card">
            <h2 className="mb-1 font-semibold">Imagem de fundo do topo</h2>
            <p className="mb-4 text-xs text-muted">Aparece atrás do nome e do botão “Agendar horário”. Envie uma versão para desktop (horizontal) e outra para celular (vertical). Se enviar só uma, ela vale para os dois.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {COVERS.map(({ kind, title, hint, has }) => (
                <div key={kind}>
                  <p className="label">{title}</p>
                  <div
                    className={`mb-2 flex items-center justify-center overflow-hidden rounded-xl border border-line bg-background bg-cover bg-center text-xs text-muted ${kind === "desktop" ? "aspect-[16/7]" : "mx-auto aspect-[9/14] max-h-56"}`}
                    style={has(data) ? { backgroundImage: `url(/api/public/cover?kind=${kind}&v=${data.coverVersion})` } : undefined}
                  >
                    {!has(data) && "Sem imagem"}
                  </div>
                  <input id={`cover-${kind}`} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => { uploadCover(kind, e.target.files?.[0]); e.target.value = ""; }} />
                  <div className="flex flex-wrap gap-2">
                    <label htmlFor={`cover-${kind}`} className="btn-ghost cursor-pointer"><ImagePlus size={15} /> {has(data) ? "Trocar" : "Enviar"}</label>
                    {has(data) && <button className="btn-danger" onClick={() => removeCover(kind)}><Trash2 size={15} /> Remover</button>}
                  </div>
                  <p className="mt-1 text-xs text-muted">{hint}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold">Cores</h2>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Paletas prontas">
                {PRESETS.map((p) => (
                  <button key={p.name} className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setTheme(p.theme)}>
                    <span className="flex">
                      {[p.theme.themeBg, p.theme.themePrimary, p.theme.themeAccent].map((c) => (
                        <span key={c} className="-ml-1 size-3.5 rounded-full border border-line first:ml-0" style={{ background: c }} />
                      ))}
                    </span>
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
            {([["Cores da marca (valem nos dois modos)", BRAND_FIELDS], ["Modo escuro", DARK_FIELDS], ["Modo claro", LIGHT_FIELDS]] as const).map(([title, fields]) => (
              <fieldset key={title} className="mt-5 first-of-type:mt-0">
                <legend className="mb-3 text-sm font-semibold">{title}</legend>
                <div className="grid gap-4 sm:grid-cols-2">
                  {fields.map(({ key, label, hint }) => (
                    <div key={key}>
                      <label className="label" htmlFor={key}>{label}</label>
                      <div className="flex gap-2">
                        <input
                          aria-label={`${label} (seletor)`}
                          type="color"
                          className="h-[42px] w-14 shrink-0 cursor-pointer rounded-xl border border-line bg-background p-1"
                          value={HEX.test(theme[key]) ? theme[key] : "#000000"}
                          onChange={(e) => setTheme({ ...theme, [key]: e.target.value })}
                        />
                        <input id={key} className="input font-mono" maxLength={7} value={theme[key]} onChange={(e) => setTheme({ ...theme, [key]: e.target.value })} aria-invalid={!HEX.test(theme[key])} />
                      </div>
                      <p className="mt-1 text-xs text-muted">{hint}</p>
                    </div>
                  ))}
                </div>
              </fieldset>
            ))}
            {!valid && <p role="alert" className="mt-4 text-sm text-red-300">Use o formato #RRGGBB em todas as cores.</p>}
            {problems.map((p) => <p key={p} role="alert" className="mt-4 text-sm text-amber-300">{p}</p>)}
          </section>

          <div className="actionbar">
            <button className="btn-primary" disabled={busy || !valid || problems.length > 0} onClick={save}>Salvar personalização</button>
            <button className="btn-ghost" onClick={() => setTheme(DEFAULT_THEME)}><RotateCcw size={15} /> Restaurar cores padrão</button>
          </div>
        </div>

        {/* Prévia ao vivo (mesmas variáveis CSS da página pública) */}
        <aside className="xl:sticky xl:top-6" aria-label="Prévia">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <p className="label !mb-0">Prévia para as clientes</p>
            <div className="flex gap-1" role="group" aria-label="Modo da prévia">
              {(["dark", "light"] as const).map((m) => (
                <button key={m} type="button" aria-pressed={previewMode === m} onClick={() => setPreviewMode(m)} className={`rounded-lg px-2.5 py-1 text-xs font-medium ${previewMode === m ? "bg-brand text-on-brand" : "border border-line text-muted"}`}>
                  {m === "dark" ? "Escuro" : "Claro"}
                </button>
              ))}
            </div>
          </div>
          <div
            style={valid ? (themeVars(theme, previewMode) as React.CSSProperties) : undefined}
            className="overflow-hidden rounded-2xl border border-line bg-background text-ink"
          >
            {/* Mesma composição da página da cliente: luzes da marca, banner com degradê, logo grande e cartão de serviços. */}
            <div className="relative isolate overflow-hidden">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 -z-20"
                style={{ background: "radial-gradient(ellipse 70% 50% at 10% 0%, color-mix(in srgb, var(--color-brand) 22%, transparent), transparent 60%), radial-gradient(ellipse 60% 45% at 95% 15%, color-mix(in srgb, var(--color-accent) 18%, transparent), transparent 60%)" }}
              />
              <div className="relative isolate overflow-hidden px-5 pb-6 pt-8 text-center">
                {(data.hasCoverDesktop || data.hasCoverMobile) && (
                  <>
                    <div
                      aria-hidden
                      className="absolute inset-0 -z-20 bg-cover bg-center"
                      style={{ backgroundImage: `url(/api/public/cover?kind=${data.hasCoverMobile ? "mobile" : "desktop"}&v=${data.coverVersion})`, WebkitMaskImage: "linear-gradient(to bottom, black 45%, transparent 92%)", maskImage: "linear-gradient(to bottom, black 45%, transparent 92%)" }}
                    />
                    <div
                      aria-hidden
                      className="absolute inset-0 -z-10"
                      style={{ background: "linear-gradient(180deg, color-mix(in srgb, var(--color-background) 10%, transparent) 0%, color-mix(in srgb, color-mix(in srgb, var(--color-background) 52%, var(--color-brand)) 85%, transparent) 50%, color-mix(in srgb, var(--color-background) 60%, transparent) 80%, transparent 100%)" }}
                    />
                  </>
                )}
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt="" className="mx-auto h-auto w-56 max-w-full object-contain" />
                ) : (
                  <p className="text-2xl font-semibold text-accent">{data.name}</p>
                )}
                {tagline && <p className="mt-2 text-xs text-muted">{tagline}</p>}
              </div>
              <div className="px-4 pb-4">
                <div className="rounded-[10px] border border-accent bg-surface p-4">
                  <p className="mb-3 text-[14px] font-semibold">1.Escolha o serviço</p>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3 rounded-[10px] border-2 border-brand bg-brand/10 p-3 text-left">
                      <span>
                        <span className="block text-[13px] font-bold">Manicure</span>
                        <span className="block text-[11px] text-muted">Duração: 45 min</span>
                      </span>
                      <span className="text-[13px] font-bold">R$ 45,00</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-[10px] border border-brand/10 bg-brand/5 p-3 text-left">
                      <span>
                        <span className="block text-[13px] font-bold">Pedicure</span>
                        <span className="block text-[11px] text-muted">Duração: 1h</span>
                      </span>
                      <span className="text-[13px] font-bold">R$ 55,00</span>
                    </div>
                  </div>
                  <span className="mt-4 flex h-11 items-center justify-center rounded-[8px] bg-accent text-[14px] font-bold text-white">Reservar e pagar o sinal</span>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
