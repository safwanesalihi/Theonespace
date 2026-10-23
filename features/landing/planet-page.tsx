"use client";
// A topic's own page (/espace/<slug>): what a shared link or a search engine opens. On the landing, the
// same content opens as a window over the page (windows.tsx).
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useI18n } from "@/lib/i18n/locale-provider";
import { planets, type PlanetSlug } from "./planets";
import { landingFonts } from "./fonts";
import "./landing.css";
import "./space.css";

export default function PlanetPage({ slug }: { slug: PlanetSlug }) {
  const { t, dir } = useI18n();
  const planet = planets.find((p) => p.slug === slug)!;
  const Icon = planet.icon;
  return (
    <div className={`os ts-planet-site ${landingFonts}`} dir={dir}>
      <section className="ts-planet">
        <div className="ts-wrap ts-planet-in">
          <Link href="/" className="ts-planet-back"><ArrowLeft size={15} className="os-arrow" aria-hidden="true" />The One Space</Link>
          <span className="ts-planet-icon"><Icon size={22} aria-hidden="true" /></span>
          <h1>{t(planet.title)}</h1>
          <p>{t(planet.tagline)}</p>
          <ol className="ts-win-points">
            {planet.points.map(([head, text], i) => <li key={head}><b>{String(i + 1).padStart(2, "0")}</b><div><h3>{t(head)}</h3><p>{t(text)}</p></div></li>)}
          </ol>
        </div>
      </section>
    </div>
  );
}
