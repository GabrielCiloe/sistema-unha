// Tema editável pelo administrador. Funções puras (usadas no servidor, no cliente e na prévia).

export type Theme = {
  themeBg: string;
  themeSurface: string;
  themeText: string;
  themePrimary: string;
  themeAccent: string;
  themeConfirm: string;
  // Tons neutros do modo claro (o modo escuro usa themeBg/themeSurface/themeText; as 3 cores de marca valem para os dois).
  themeLightBg: string;
  themeLightSurface: string;
  themeLightText: string;
};

export type Mode = "dark" | "light";

export const DEFAULT_THEME: Theme = {
  themeBg: "#0f0c1b",
  themeSurface: "#1e192b",
  themeText: "#ffffff",
  themePrimary: "#7c3aed",
  themeAccent: "#ec4899",
  themeConfirm: "#10b981",
  themeLightBg: "#faf7f5",
  themeLightSurface: "#ffffff",
  themeLightText: "#2b2230",
};

export const HEX = /^#[0-9a-fA-F]{6}$/;

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

const toHex = ([r, g, b]: number[]) =>
  "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");

// Mistura `a` com `b` (t = 0 → a, t = 1 → b).
export const mix = (a: string, b: string, t: number) => {
  const x = rgb(a);
  const y = rgb(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
};

const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
};

// Cor do texto sobre um botão colorido (preto ou branco, o que tiver mais contraste).
export const onColor = (bg: string) => (contrast(bg, "#ffffff") >= contrast(bg, "#000000") ? "#ffffff" : "#000000");

// Mensagens para o admin quando a combinação ficaria ilegível. Vazio = ok.
export function themeProblems(t: Theme) {
  const out: string[] = [];
  const check = (text: string, bg: string, surface: string, mode: string) => {
    if (contrast(text, bg) < 4.5) out.push(`${mode}: o texto fica pouco legível sobre a cor de fundo (contraste mínimo 4,5:1).`);
    if (contrast(text, surface) < 4.5) out.push(`${mode}: o texto fica pouco legível sobre a cor dos cartões (contraste mínimo 4,5:1).`);
  };
  check(t.themeText, t.themeBg, t.themeSurface, "Modo escuro");
  check(t.themeLightText, t.themeLightBg, t.themeLightSurface, "Modo claro");
  return out;
}

// Variáveis CSS de um modo. Derivadas calculadas aqui porque var() não "re-resolve" em escopos filhos.
export function themeVars(t: Theme, mode: Mode = "dark"): Record<string, string> {
  const light = mode === "light";
  const bg = light ? t.themeLightBg : t.themeBg;
  const surface = light ? t.themeLightSurface : t.themeSurface;
  const text = light ? t.themeLightText : t.themeText;
  return {
    "--color-background": bg,
    "--color-surface": surface,
    "--color-surface-2": mix(surface, text, light ? 0.06 : 0.07),
    "--color-line": mix(surface, text, light ? 0.16 : 0.2),
    "--color-ink": text,
    "--color-muted": mix(text, bg, light ? 0.35 : 0.4),
    "--color-brand": t.themePrimary,
    "--color-brand-soft": mix(t.themePrimary, text, light ? 0.25 : 0.45),
    "--color-accent": t.themeAccent,
    "--color-confirm": t.themeConfirm,
    "--color-on-brand": onColor(t.themePrimary),
    "--color-on-confirm": onColor(t.themeConfirm),
  };
}

// CSS global com os dois modos; o atributo data-mode do <html> escolhe qual vale (ver ThemeToggle).
export function themeCss(input: Theme) {
  const t: Theme = { ...DEFAULT_THEME, ...Object.fromEntries(Object.entries(input).filter(([, v]) => typeof v === "string" && HEX.test(v))) };
  const block = (mode: Mode) => Object.entries(themeVars(t, mode)).map(([k, v]) => `${k}:${v}`).join(";");
  return `:root,html[data-mode="dark"]{${block("dark")}}html[data-mode="light"]{${block("light")}}`;
}
