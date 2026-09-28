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
export const defaultBrandColor = '#efb849';
export const brandId = (workspaceId: string) => `brand:${workspaceId}`;
export const isHexColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);

/** Suggested colours for the picker (the first is The One Core's amber). */
export const brandPresets = ['#efb849', '#e0533d', '#d6336c', '#7c4dff', '#3a7bd5', '#1e9e8f', '#2f9e44', '#20232a'];

const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
const toHex = (rgb: number[]) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const mix = (hex: string, other: number[], amount: number) => toHex([0, 1, 2].map((i) => channel(hex, i) * (1 - amount) + other[i] * amount));
const luminance = (hex: string) => {
  const [r, g, b] = [0, 1, 2].map((i) => { const c = channel(hex, i) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * The app's brand tokens (tokens.css --t-brand-*) for one colour: a darker hover and border, a pale
 * tint for highlighted rows, and the text ON the colour. Light colours (amber, yellow, sky) take black
 * text; the others take white — never black on a mid blue, red or green — and when white would not
 * reach 4.5:1 (WCAG AA) the filled colour is deepened just enough that it does, keeping its hue.
 */
export function brandTokens(color: string) {
  const light = luminance(color) > 0.3;
  let fill = color;
  if (!light) for (let step = 0.04; contrast(luminance(fill), 1) < 4.5 && step <= 0.6; step += 0.04) fill = mix(color, [0, 0, 0], step);
  return {
    '--t-brand': fill,
    '--t-brand-strong': mix(fill, [0, 0, 0], 0.08),
    '--t-brand-border': mix(fill, [0, 0, 0], 0.18),
    '--t-brand-ink': light ? '#1b1a17' : '#ffffff',
    '--t-brand-tint': mix(color, [255, 255, 255], 0.9),
  } as Record<string, string>;
}
