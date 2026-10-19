/**
 * Clinic theming. The whole app's accent colour is Tailwind's `sky` scale, which tailwind.config.ts reads from
 * CSS variables. Calling applyBrand(hex) rewrites those variables, so every screen follows the clinic's colour.
 */
type RGB = [number, number, number];
const SKY: Record<number, RGB> = { 50: [240, 249, 255], 100: [224, 242, 254], 200: [186, 230, 253], 300: [125, 211, 252], 400: [56, 189, 248], 500: [14, 165, 233], 600: [2, 132, 199], 700: [3, 105, 161], 800: [7, 89, 133], 900: [12, 74, 110], 950: [8, 47, 73] };
const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

const hexToRgb = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as RGB;
const luminance = ([r, g, b]: RGB) => { const f = (c: number) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };

/** 11-step scale where 600 is the brand colour, darkened if needed so white text on it stays readable (contrast >= 4.5). */
export function paletteFor(hex: string): Record<number, RGB> {
  let base = hexToRgb(hex);
  for (let i = 0; i < 12 && 1.05 / (luminance(base) + 0.05) < 4.5; i++) base = mix(base, [0, 0, 0], 0.1);
  const white: RGB = [255, 255, 255], black: RGB = [0, 0, 0];
  const out: Record<number, RGB> = {};
  const t: Record<number, number> = { 50: 0.93, 100: 0.85, 200: 0.7, 300: 0.5, 400: 0.28, 500: 0.12 };
  for (const s of STEPS) {
    out[s] = s < 600 ? mix(base, white, t[s]) : s === 600 ? base : s === 700 ? mix(base, black, 0.15) : s === 800 ? mix(base, black, 0.3) : s === 900 ? mix(base, black, 0.45) : mix(base, black, 0.65);
  }
  return out;
}

export function applyBrand(hex?: string | null) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const valid = !!hex && /^#[0-9a-fA-F]{6}$/.test(hex);
  const pal = valid ? paletteFor(hex!) : SKY;
  for (const s of STEPS) root.style.setProperty(`--sky-${s}`, pal[s].join(" "));
  if (valid) root.style.setProperty("--accent", `rgb(${pal[600].join(",")})`); else root.style.removeProperty("--accent");
}

/** Browser tab title and icon follow the clinic. */
export function applyIdentity(name?: string | null, logoUrl?: string | null) {
  if (typeof document === "undefined") return;
  if (name) document.title = `${name} · Mediflow`;
  if (logoUrl) {
    let l = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!l) { l = document.createElement("link"); l.rel = "icon"; document.head.appendChild(l); }
    l.href = logoUrl;
  }
}
