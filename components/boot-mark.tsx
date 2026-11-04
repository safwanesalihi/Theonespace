"use client";
// The mark a loading screen shows for a remembered brand (lib/boot-brand.ts): the agency's logo, else its
// name; The One Core's logo for its own studio; nothing known → a neutral pulse, never another brand's.
import { useState } from "react";
import { ParticleMark } from "./particle-mark";
import { bootBrandLogo, type BootBrand } from "@/lib/boot-brand";

export function BootMark({ brand, logoClass, textColor = "#ffffff" }: { brand: BootBrand | null; logoClass?: string; textColor?: string }) {
  const [failed, setFailed] = useState(false);
  if (!brand) return <ParticleMark shape={{ kind: "none" }} />;
  const logo = bootBrandLogo(brand);
  if (logo && !failed) return <ParticleMark shape={{ kind: "image", src: logo }} className={logoClass ?? (brand.white ? "on-dark-white" : "")} onFail={() => setFailed(true)} />;
  return <ParticleMark shape={{ kind: "text", text: brand.name, color: textColor }} />;
}
