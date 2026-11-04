// The brand a loading screen shows before any script runs: the last agency this browser opened, kept in a
// small cookie (features/workspace/brand-store.ts writes it, forgets it at sign-out) so the server can draw
// it in the very first frame (app/loading.tsx, app/page.tsx). Only what the screen needs: name, logo id,
// colour, and whether the logo turns white on the dark screen. Nothing remembered → a neutral screen.
export const bootBrandCookie = "the-one.brand";
/** `core`: The One Core's own studio (not a company's workspace), whose loader shows The One Core's logo. */
export type BootBrand = { name: string; logo?: string; color?: string; white?: boolean; core?: boolean };

const isLogoId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_.:-]{1,120}$/.test(v);
const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

export function encodeBootBrand(brand: BootBrand) {
  return encodeURIComponent(JSON.stringify({ n: brand.name.slice(0, 80), ...(brand.logo ? { l: brand.logo } : {}), ...(brand.color ? { c: brand.color } : {}), ...(brand.white ? { w: 1 } : {}), ...(brand.core ? { k: 1 } : {}) }));
}

export function decodeBootBrand(value: string | undefined | null): BootBrand | null {
  if (!value) return null;
  try {
    const raw = JSON.parse(decodeURIComponent(value)) as { n?: unknown; l?: unknown; c?: unknown; w?: unknown; k?: unknown };
    if (typeof raw.n !== "string" || !raw.n.trim()) return null;
    return { name: raw.n.slice(0, 80), ...(isLogoId(raw.l) ? { logo: raw.l } : {}), ...(isHex(raw.c) ? { color: raw.c } : {}), ...(raw.w ? { white: true } : {}), ...(raw.k ? { core: true } : {}) };
  } catch { return null; }
}

/** The same address as the app's own logo (brand-store.ts brandLogoUrl), so the browser fetches it once. */
export const bootBrandLogo = (brand: BootBrand) => (brand.logo ? `/api/assets/${brand.logo}` : brand.core ? "/the-one-core-logo.svg" : null);
