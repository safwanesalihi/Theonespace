"use client";
import { useEffect, useState } from "react";
import { ProductMark } from "@/components/product-mark";
import { brandLogoClass, brandLogoUrl, lastBrand, type CurrentBrand } from "@/features/workspace/brand-store";

/**
 * Whose brand a loading screen shows: the agency this browser last opened (its logo, else its name),
 * The One Core's own studio, or The One Space when nothing is known. Decided after mount, so the
 * server render (an empty slot of the same height) never shows the wrong brand.
 */
export function SessionMark() {
  const [brand, setBrand] = useState<CurrentBrand | null | undefined>(undefined);
  const [logoFailed, setLogoFailed] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only memory, read once after hydration
  useEffect(() => setBrand(lastBrand()), []);
  if (brand === undefined) return <span className="session-mark-slot" aria-hidden="true" />;
  const logo = brandLogoUrl(brand);
  if (brand && logo && !logoFailed) {
    // eslint-disable-next-line @next/next/no-img-element -- a workspace upload served by /api/assets
    return <img className={`session-mark-logo ${brandLogoClass(brand)}`} src={logo} alt={brand.name} onError={() => setLogoFailed(true)} />;
  }
  if (brand?.company) return <span className="session-mark-name">{brand.name}<span className="wordmark-dot">.</span></span>;
  // eslint-disable-next-line @next/next/no-img-element -- SVG logo
  if (brand) return <img className="auth-logo" src="/the-one-core-logo.svg" alt="The One Core" />;
  return <ProductMark className="auth-logo" />;
}
