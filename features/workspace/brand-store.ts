"use client";
// The current workspace's brand, for every part of the app that shows one (sidebar, client portal, call
// window, assistant, PDFs): set by the workspace session (use-workspace-session.ts) from /api/records, read with useBrand(). The logo
// shows everywhere, and so does the colour: the studio, its client portal (usePortalSurface), e-mails and
// PDFs on the server. Without a colour of its own, a workspace keeps The One Space's gold, black and grey.
import { useEffect, useSyncExternalStore } from "react";
import { brandSheet, brandTokens, defaultBrandColor, isHexColor, logoWhiteOnDark, type Brand } from "@/lib/branding";
import { bootBrandCookie, encodeBootBrand, type BootBrand } from "@/lib/boot-brand";

export type CurrentBrand = Brand & {
  /** A company's own workspace (public sign-up): its name replaces « The One Core » everywhere. */
  company: boolean;
};

let current: CurrentBrand | null = null;
const listeners = new Set<() => void>();
const brandSheetId = "the-one-brand";

/** The colour's tokens for the whole page (studio and portal, overlays included): one small sheet. */
function applyColor(color?: string) {
  if (typeof document === "undefined") return;
  let sheet = document.getElementById(brandSheetId);
  if (!color || !isHexColor(color)) { sheet?.remove(); return; }
  if (!sheet) { sheet = document.createElement("style"); sheet.id = brandSheetId; }
  document.head.appendChild(sheet); // last in <head>, after any stylesheet loaded since
  // The One Core's own gold keeps the studio's designed metal; only its portal takes the flat tokens.
  sheet.textContent = color.toLowerCase() === defaultBrandColor
    ? `:root[data-surface=portal]{${Object.entries(brandTokens(color)).map(([name, value]) => `${name}:${value}`).join(";")}}`
    : brandSheet(color);
}

/** Marks the page as the client portal while it is shown (its flat, agency-lit look in surfaces.css and sky.css). */
export function usePortalSurface() {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.surface = "portal";
    return () => { delete root.dataset.surface; };
  }, []);
}

export function setBrand(brand: CurrentBrand | null) {
  if (JSON.stringify(brand) === JSON.stringify(current)) return;
  current = brand;
  applyColor(brand?.color);
  remember(brand);
  listeners.forEach((listener) => listener());
}

// The last brand this browser opened, so the next visit's loading screen shows the agency's own brand
// (and colour) instead of The One Space's while /api/records is in flight. Forgotten at sign-out.
const lastBrandKey = "the-one.brand";
// Each workspace's own, by name, for the screen shown while switching to it (session-screens.tsx).
const brandsKey = "the-one.brands";
function remember(brand: CurrentBrand | null) {
  try {
    if (brand) {
      localStorage.setItem(lastBrandKey, JSON.stringify(brand));
      const all = JSON.parse(localStorage.getItem(brandsKey) ?? "{}") as Record<string, CurrentBrand>;
      all[brand.name] = brand;
      localStorage.setItem(brandsKey, JSON.stringify(Object.fromEntries(Object.entries(all).slice(-12))));
    } else { localStorage.removeItem(lastBrandKey); localStorage.removeItem(brandsKey); }
  } catch { /* private mode */ }
  // The same, small, in a cookie: the server draws it in the loading screen's first frame (lib/boot-brand.ts).
  if (typeof document !== "undefined") {
    document.cookie = brand
      ? `${bootBrandCookie}=${encodeBootBrand(bootBrandOf(brand))}; path=/; max-age=31536000; samesite=lax`
      : `${bootBrandCookie}=; path=/; max-age=0; samesite=lax`;
  }
}
/** What a loading screen needs of a brand (lib/boot-brand.ts). */
export const bootBrandOf = (brand: CurrentBrand): BootBrand => ({ name: brand.name, logo: brand.logo, color: brand.color, white: logoWhiteOnDark(brand), core: !brand.company });
/** A workspace's remembered brand, by its name (none yet → null). */
export function rememberedBrand(name: string | undefined): CurrentBrand | null {
  if (!name) return null;
  try { return (JSON.parse(localStorage.getItem(brandsKey) ?? "{}") as Record<string, CurrentBrand>)[name] ?? null; } catch { return null; }
}
/** Read after mount only: the server render never knows it. */
export function lastBrand(): CurrentBrand | null {
  try {
    const brand = JSON.parse(localStorage.getItem(lastBrandKey) ?? "null") as CurrentBrand | null;
    if (!brand || typeof brand.name !== "string") return null;
    applyColor(brand.color);
    return brand;
  } catch { return null; }
}
export const forgetBrand = () => remember(null);

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useBrand = () => useSyncExternalStore(subscribe, () => current, () => null);

/** Who the app speaks for: the company's name in its own workspace, The One Core in the studio's. */
export const studioLabel = (brand: CurrentBrand | null) => (brand?.company ? brand.name : "The One Core");
export const brandLogoUrl = (brand: CurrentBrand | null) => (brand?.logo ? `/api/assets/${brand.logo}` : null);
/** The logo for PDFs: the workspace's own, none for a company without one, else The One Core's (undefined). */
export const brandPdfLogo = (brand: CurrentBrand | null) => {
  const id = brand?.logoLight ?? brand?.logo; // a light logo's dark twin on white paper
  return id ? `/api/assets/${id}` : brand?.company ? null : undefined;
};
/** Class for the logo on the app's dark surfaces (sidebar, portal, call bar): white when it would not read. */
export const brandLogoClass = (brand: CurrentBrand | null) => `brand-logo${logoWhiteOnDark(brand) ? " on-dark-white" : ""}`;
/** Light navigation uses the original dark logo or the uploaded light-surface variant. */
export const brandLightLogoClass = (brand: CurrentBrand | null) => `brand-logo${brand?.logoTone === 'light' && !brand.logoLight ? ' on-light-dark' : ''}`;
