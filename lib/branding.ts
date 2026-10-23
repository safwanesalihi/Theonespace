// A workspace's own brand — for companies that signed up (lib/signup.ts), and optionally for the
// studio: its logo and main colour replace The One Core's in the app, the client portal, calls,
// e-mails and PDFs. The name is the workspace's own (workspaces.name). Stored in a 'meta' row, never
// part of the records everyone loads. Pure helpers here, usable in the browser too.

/**
 * `logo`: the logo as uploaded (trimmed PNG, transparent); `logoLight`: its dark twin for white surfaces,
 * when the logo itself is light; `logoTone`: measured on upload; `logoOnDark`: how it shows on the dark
 * sidebar, portal and call bar — 'auto' (a dark logo turns white), 'original' colours, or 'white'.
 */
export type LogoOnDark = 'auto' | 'original' | 'white';
export type Brand = { name: string; logo?: string; logoLight?: string; logoTone?: 'dark' | 'light'; logoOnDark?: LogoOnDark; color?: string };
export const logoOnDarkModes: LogoOnDark[] = ['auto', 'original', 'white'];
/** Whether the logo is drawn in white on the app's dark surfaces. */
export const logoWhiteOnDark = (brand: Pick<Brand, 'logoTone' | 'logoOnDark'> | null | undefined) =>
  brand?.logoOnDark === 'white' || ((brand?.logoOnDark ?? 'auto') === 'auto' && brand?.logoTone === 'dark');
export const defaultBrandColor = '#d4af37';
export const brandId = (workspaceId: string) => `brand:${workspaceId}`;
export const isHexColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);

/** Suggested colours for the picker (the first is The One Core's amber). */
export const brandPresets = ['#d4af37', '#e0533d', '#d6336c', '#7c4dff', '#3a7bd5', '#1e9e8f', '#2f9e44', '#20232a'];

const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
const toHex = (rgb: number[]) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const mix = (hex: string, other: number[], amount: number) => toHex([0, 1, 2].map((i) => channel(hex, i) * (1 - amount) + other[i] * amount));
const luminance = (hex: string) => {
  const [r, g, b] = [0, 1, 2].map((i) => { const c = channel(hex, i) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * The app's brand tokens (tokens.css --t-brand-*) for one colour: a lighter hover, a pale tint for
 * highlighted rows on light, and the text ON the colour. Light colours (amber, yellow, sky) take black
 * text; the others take white — never black on a mid blue, red or green — and when white would not
 * reach 4.5:1 (WCAG AA) the filled colour is deepened just enough that it does, keeping its hue.
 * A light colour is never darkened and never mixed into the dark surfaces: gold mixed with black reads
 * brown. Its labels on light are black, and dark tints stay neutral.
 */
export function brandTokens(color: string) {
  const light = luminance(color) > 0.3;
  let fill = color;
  if (!light) for (let step = 0.04; contrast(luminance(fill), 1) < 4.5 && step <= 0.6; step += 0.04) fill = mix(color, [0, 0, 0], step);
  const tintLight = mix(color, [255, 255, 255], 0.9);
  const tintDark = '#27272a';
  const readable = (backgrounds: string[], toward: number[]) => {
    let ink = color;
    for (let step = 0.04; backgrounds.some(background => contrast(luminance(ink), luminance(background)) < 4.5) && step <= 1; step += 0.04) ink = mix(color, toward, step);
    return ink;
  };
  const hover = mix(fill, [255, 255, 255], 0.12);
  return {
    '--t-brand': fill,
    '--t-brand-strong': fill,
    '--t-brand-hover': hover,
    '--t-brand-border': 'var(--t-line-strong)',
    '--t-brand-ink': light ? '#0a0a0a' : '#ffffff',
    '--t-brand-tint-light': tintLight,
    '--t-brand-tint-dark': tintDark,
    '--t-brand-tint': 'var(--t-brand-tint-current)',
    '--t-brand-text-light': light ? '#0a0a0a' : readable(['#f4f4f5', tintLight], [0, 0, 0]),
    '--t-brand-text-dark': readable(['#27272a', tintDark], [255, 255, 255]),
    '--gold-metal': fill,
  } as Record<string, string>;
}
