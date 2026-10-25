"use client";
// The public home page (app/page.tsx shows it to anyone signed out): the hero and its plain-words
// introduction (space-hero.tsx), then the rest of the story (sections.tsx), all inside the window system
// that opens the six topics over the page (windows.tsx). landing.css keeps the page's base: the .os
// scope, its public palette and the shared width.
import SpaceHero, { SpaceIntro, useCta } from "./space-hero";
import LandingSections from "./sections";
import { WindowsProvider } from "./windows";
import { useI18n } from "@/lib/i18n/locale-provider";
import "./landing.css";

export { company } from "./company";

export default function Landing({ signup }: { signup: boolean }) {
  const { dir } = useI18n();
  const cta = useCta(signup);
  return (
    <div className={`os ts-site`} dir={dir}>
      {/* Without JavaScript the scroll reveals never run: show everything as it is. */}
      <noscript><style>{".ts-site [style*='opacity:0'],.ts-site [style*='opacity: 0']{opacity:1!important;transform:none!important}"}</style></noscript>
      <WindowsProvider cta={cta}>
        <SpaceHero cta={cta} />
        <SpaceIntro />
        <LandingSections cta={cta} />
      </WindowsProvider>
    </div>
  );
}
