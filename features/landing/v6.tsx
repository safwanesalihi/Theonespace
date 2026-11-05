"use client";
// The public page, for marketing agencies that buy software: the real app, large, on V2's brushed-silver
// panel, then one idea per screen — the six tools it replaces, the agency's own method (built in five
// questions), the rules it keeps, the client's side, the agency's numbers, the rest of the everyday, the
// prices, the pilot agencies' word (a place kept for it), the pilot call, the questions and the footer. Every picture is a real screen of the app with demo data
// (public/landing/v6), and the prices as decided (Pricing, with the pilot offer). Gold moves only for the decision: the stamp that strikes once on the hero's phone,
// and the one the visitor strikes on the client's cards. The effects come from React Bits (fx/): the
// headline out of a blur, gold light falling on the hero (wide screens only), the endless row of networks.
// This file is the first screen (the header and the hero), with no motion library; everything below comes
// in its own chunk (v6-sections.tsx), still drawn by the server, so the page reads before it arrives.
// The pieces both use (the screens, the stamp, the links) are in v6-parts.tsx.
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Menu, X } from "lucide-react";
import LanguageSwitch from "@/components/language-switch";
import { useI18n } from "@/lib/i18n/locale-provider";
import { DeepPanel, useEntering, useScrolledPast, useStill } from "./ui-base";
import BlurText from "./fx/blur-text";
import { PhoneShot, Screen, Stamp, away, outward, type Cta } from "./v6-parts";
import type { LandingContent } from "./content";

const Sections = dynamic(() => import("./v6-sections"));
const Footer = dynamic(() => import("./v6-sections").then((s) => s.Footer));

export { useCta } from "./v6-parts";

function TopBar({ cta, prices }: { cta: Cta; prices: boolean }) {
  const { t } = useI18n();
  const [menu, setMenu] = useState(false);
  const tight = useScrolledPast(40);
  const links = [["#methode", t("Votre méthode")], ["#regles", t("Vos règles")], ["#client", t("Côté client")], ...(prices ? [["#tarifs", t("Tarifs")]] : []), ["#questions", t("Questions")]];
  return (
    <header className={`ts-top${tight ? " tight" : ""}`}>
      <div className="ts-capsule">
        <a href="#" className="ts-brand" aria-label="The One Space">
          {/* eslint-disable-next-line @next/next/no-img-element -- SVG mark */}
          <img src="/favicon.svg" alt="" width={26} height={26} /><span>The One Space</span>
        </a>
        <nav className={`ts-menu${menu ? " open" : ""}`} aria-label={t("Navigation")}>
          {links.map(([href, label]) => <span key={href} className="ts-menu-item"><a href={href} onClick={() => setMenu(false)}>{label}</a></span>)}
          <a href="/login" className="ts-menu-login">{t("Connexion")}</a>
        </nav>
        <div className="ts-top-right">
          <LanguageSwitch compact />
          <a className="ts-login" href="/login">{t("Connexion")}</a>
          <a className="ts-pill" href={cta.href} {...outward(cta)}>{cta.label}</a>
          <button type="button" className="ts-burger" aria-label={t("Menu")} aria-expanded={menu} onClick={() => setMenu(!menu)}>{menu ? <X size={20} /> : <Menu size={20} />}</button>
        </div>
      </div>
    </header>
  );
}

/** The owner's banner (Plateforme → Site), above the headline, in the owner's own words. */
function News({ news }: { news: NonNullable<LandingContent["announcement"]> }) {
  return (
    <p className="v6-news" role="note">
      <i aria-hidden="true" />{news.text}
      {news.link && <a href={news.link} {...away(news.link)}>{news.linkLabel}<ArrowRight size={14} aria-hidden="true" /></a>}
    </p>
  );
}

/** The hero: what it is, for whom, the rule that sets it apart, and the real app as large as the screen
 *  allows. The panel leans back and straightens as the page scrolls; once the page has settled the stamp
 *  strikes on the phone and the receipt line comes up — the page's one orchestrated moment. */
/** The hero panel's lean at `p` (0 below the fold, 1 once it sits in the middle of the window). */
const lean = (p: number) => `perspective(2400px) translateY(${40 * (1 - p)}px) rotateX(${14 * (1 - p)}deg)`;

function Hero({ cta, news }: { cta: Cta; news: LandingContent["announcement"] }) {
  const { t } = useI18n();
  const still = useStill();
  const stage = useRef<HTMLDivElement>(null);
  const [stamped, setStamped] = useState(false);
  useEffect(() => {
    const go = setTimeout(() => setStamped(true), still ? 0 : 1700);
    return () => clearTimeout(go);
  }, [still]);
  // The panel leans back and straightens as it comes into view: written straight to its style on scroll
  // (the transform motion's useScroll wrote: same perspective, lift and lean, from the same first frame).
  const tilt = useRef<HTMLDivElement>(null);
  useEntering(stage, (p) => { if (tilt.current && !still) tilt.current.style.transform = lean(p); });
  return (
    <section className="v6-hero" aria-labelledby="v6-title">
      <div className="v6-rays" aria-hidden="true" />
      <div className="v6-hero-head">
        {news && <News news={news} />}
        <p className="v6-for">{t("Pour les agences social media, contenu, vidéo et branding")}</p>
        <h1 id="v6-title"><BlurText text={t("Le logiciel des agences marketing.")} delay={0.15} /></h1>
        <p className="v6-lead">{t("Votre méthode, vos relectures, et des clients qui valident depuis leur téléphone. Sans réponse en 48 h, c’est validé, avec un reçu daté.")}</p>
        <div className="v6-ctas">
          <a className="v6-btn gold" href={cta.href} {...outward(cta)}>{cta.label}</a>
          <a className="v6-btn line" href="#methode">{t("Voir l’espace")}</a>
        </div>
      </div>
      <div className="v6-stage" ref={stage}>
        <div className="v6-tilt" ref={tilt} style={still ? undefined : { transform: lean(0) }}>
          <DeepPanel tone="silver" className="v6-panel">
            <Screen src="/landing/v6/01-accueil.webp" alt={t("L’accueil de l’espace : la priorité du jour et les contenus en attente du client")} priority />
          </DeepPanel>
        </div>
        <div className="v6-hero-phone">
          <PhoneShot src="/landing/v6/04-tache-chez-le-client-phone.webp" alt={t("Un livrable chez le client, avec le temps qu’il lui reste pour répondre")} />
          <span className="v6-hero-stamp">{stamped && <Stamp play size={84} />}</span>
        </div>
        <p className={`v6-receipt-line${stamped ? " on" : ""}${still ? " still" : ""}`} aria-live="polite">
          <Check size={15} aria-hidden="true" /><span>{t("Café Atlas a validé « Carrousel 3 spots ». Reçu n° 0412 ajouté à l’historique.")}</span>
        </p>
      </div>
    </section>
  );
}

export default function LandingV6({ cta, content }: { cta: Cta; content: LandingContent }) {
  return (
    <>
      <TopBar cta={cta} prices={!!content.prices} />
      <main>
        <Hero cta={cta} news={content.announcement} />
        <Sections cta={cta} content={content} />
      </main>
      <Footer contact={content.contact} social={content.social} prices={!!content.prices} />
    </>
  );
}
