"use client";
// The public home page (app/(app)/page.tsx shows it to anyone signed out): the story in v6.tsx. landing.css keeps
// the page's base (the .os scope and its public palette, read by scripts/check-theme.mjs); space.css and
// sections.css hold V2's materials (the silver page, the capsule, the deep panels and their gold waves,
// the hub, the questions and the footer); v6.css lays out this page on top of them.
import LandingV6, { useCta } from "./v6";
import { useI18n } from "@/lib/i18n/locale-provider";
import { preferPublicDictionary } from "@/lib/i18n";
import type { LandingContent } from "./content";
import "./landing.css";
import "./space.css";
import "./sections.css";
import "./v6.css";

export { company } from "./company";

// English and Arabic visitors get the page's own words (lib/i18n/public-dictionary.ts, a few kilobytes),
// not the whole app's dictionaries. Set as this module loads, before the language provider asks.
preferPublicDictionary();

export default function Landing({ content }: { content: LandingContent }) {
  const { dir } = useI18n();
  const cta = useCta();
  return (
    <div className="os ts-site v6" dir={dir}>
      <LandingV6 cta={cta} content={content} />
    </div>
  );
}
