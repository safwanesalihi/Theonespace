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

/**
 * The whole workspace in the agency's colour: the brand tokens above plus everything the default theme
 * draws in The One Core's gold (design-tokens.css: the metal of the decision button and the active nav
 * item, the gold word of a title, section rules, the edge light of cards, focus rings, heat maps), so no
 * gold is left once a studio picks its own colour. Light values on :root, night values under
 * [data-theme=dark]; doubled :root so the sheet outranks the theme's own rules wherever it loads.
 */
/** The colour as ink on white paper and light surfaces (titles, PDF headings): a light colour deepened, as The One Core's gold is. */
export function brandInk(color: string) {
  return luminance(color) > 0.3 ? mix(color, [0, 0, 0], 0.45) : brandTokens(color)['--t-brand-text-light'];
}

const rgbTriplet = (hex: string) => `${channel(hex, 0)} ${channel(hex, 1)} ${channel(hex, 2)}`;

export function brandSheet(color: string) {
  const tokens = brandTokens(color);
  const fill = tokens['--t-brand'];
  const light = luminance(color) > 0.3;
  const white = [255, 255, 255], black = [0, 0, 0];
  const [metalTop, metalEnd] = light ? [mix(fill, white, 0.5), mix(fill, black, 0.12)] : [mix(fill, white, 0.18), mix(fill, black, 0.12)];
  const shadow = rgbTriplet(fill);
  const textLight = brandInk(color);
  const textDark = tokens['--t-brand-text-dark'];
  const day: Record<string, string> = {
    ...tokens,
    '--t-gold-1': metalTop, '--t-gold-2': fill, '--t-gold-3': metalEnd,
    '--t-gold-metal': `linear-gradient(135deg, ${metalTop} 0%, ${fill} 46%, ${metalEnd} 100%)`,
    '--t-gold-metal-hover': `linear-gradient(135deg, ${mix(metalTop, white, 0.12)} 0%, ${tokens['--t-brand-hover']} 46%, ${mix(metalEnd, white, 0.12)} 100%)`,
    '--t-gold-metal-shadow': `0 10px 24px -12px rgb(${shadow} / .55), inset 0 1px 0 rgb(255 255 255 / .6)`,
    '--t-gold-text': `linear-gradient(120deg, ${textLight} 0%, ${mix(textLight, white, 0.15)} 45%, ${textLight} 100%)`,
    '--t-gold-rule': `linear-gradient(90deg, ${metalTop}, ${metalEnd})`,
    '--gold-metal': 'var(--t-gold-metal)',
    '--t-glow': fill,
    '--t-glow-spot': `rgb(${shadow} / .14)`,
    '--t-inverse-brand-text': textDark,
    '--t-inverse-focus': textDark,
    '--t-heat-0': mix(color, white, 0.9), '--t-heat-1': mix(color, white, 0.72), '--t-heat-2': mix(color, white, 0.45),
    '--t-heat-3': mix(color, white, 0.2), '--t-heat-4': fill,
    '--t-gold-rgb': rgbTriplet(light ? fill : mix(fill, white, 0.25)), '--t-gold-deep-rgb': shadow,
    '--t-gold-ink': textLight,
    '--t-brand-line': mix(color, white, 0.68),
    '--t-brand-wash': `rgb(${shadow} / .08)`,
  };
  const night: Record<string, string> = {
    '--t-gold-text': `linear-gradient(120deg, ${textDark} 0%, ${mix(textDark, white, 0.2)} 45%, ${textDark} 100%)`,
    '--t-focus': textDark,
  };
  const block = (values: Record<string, string>) => Object.entries(values).map(([name, value]) => `${name}:${value}`).join(';');
  return `:root:root{${block(day)}}:root:root[data-theme=dark]{${block(night)}}`;
}
