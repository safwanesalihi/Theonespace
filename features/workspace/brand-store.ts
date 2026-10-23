"use client";
// The current workspace's brand, for every part of the app that shows one (sidebar, client portal, call
// window, assistant, PDFs): set by the workspace session (use-workspace-session.ts) from /api/records, read with useBrand(). The logo
// shows everywhere; the colour only on what the agency's clients see: the portal here (usePortalSurface),
// e-mails and PDFs on the server. The studio itself always keeps The One Space's gold, black and grey.
import { useEffect, useSyncExternalStore } from "react";
import { brandTokens, isHexColor, logoWhiteOnDark, type Brand } from "@/lib/branding";

export type CurrentBrand = Brand & {
  /** A company's own workspace (public sign-up): its name replaces « The One Core » everywhere. */
  company: boolean;
};

let current: CurrentBrand | null = null;
const listeners = new Set<() => void>();
const brandSheetId = "the-one-brand";

/** The colour's tokens, scoped to the client portal: one small sheet keyed on <html data-surface=portal>. */
function applyColor(color?: string) {
  if (typeof document === "undefined") return;
  let sheet = document.getElementById(brandSheetId);
  if (!color || !isHexColor(color)) { sheet?.remove(); return; }
  if (!sheet) { sheet = document.createElement("style"); sheet.id = brandSheetId; document.head.appendChild(sheet); }
  const tokens = Object.entries(brandTokens(color)).map(([name, value]) => `${name}:${value}`).join(";");
  sheet.textContent = `:root[data-surface=portal]{${tokens}}`;
}

/** Marks the page as the client portal while it is shown, so the agency's colour applies (overlays included). */
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
function remember(brand: CurrentBrand | null) {
  try {
    if (brand) localStorage.setItem(lastBrandKey, JSON.stringify(brand));
    else localStorage.removeItem(lastBrandKey);
  } catch { /* private mode */ }
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
