"use client";
// The mark on the first loading screen (app/loading.tsx): the agency's own logo and name when this
// browser has already opened their workspace (features/workspace/brand-store remembers it), The One
// Space otherwise. Swapped before paint so there is no flash from The One Space to the agency.
import { useSyncExternalStore } from "react";
import { brandLogoClass, brandLogoUrl, lastBrand } from "@/features/workspace/brand-store";
import { ProductMark } from "@/components/product-mark";

// A tiny external store: lastBrand() only exists in the browser; on the server we return null.
const subscribe = () => () => {};
function cached() {
  if (typeof window === "undefined") return null;
  return lastBrand();
}

export function BootMark({ className = "" }: { className?: string }) {
  const brand = useSyncExternalStore(subscribe, cached, () => null);
  if (!brand) return <ProductMark className={className} />;
  const logo = brandLogoUrl(brand);
  if (logo) {
    return (
      <span className={`product-mark ${className}`} role="img" aria-label={brand.name} dir="ltr">
        {/* eslint-disable-next-line @next/next/no-img-element -- the agency's own uploaded logo */}
        <img className={brandLogoClass(brand)} src={logo} alt={brand.name} />
      </span>
    );
  }
  // No logo yet: the agency's name in the product-mark slot, so the name is theirs from the first paint.
  return (
    <span className={`product-mark ${className}`} role="img" aria-label={brand.name} dir="ltr">
      <span className="product-mark-name">{brand.name}</span>
    </span>
  );
}
