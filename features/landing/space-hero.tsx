"use client";
// The top of the public page, for agencies that buy software: a floating capsule navigation, then an
// editorial opening — the plain headline on the left (what the product does, for whom), the rule that
// sets it apart and the two calls to action on the right — and below it the real app (a screenshot with
// sample data) on a brushed-silver panel, with the approval receipt that gets stamped once, the page's one
// orchestrated moment. The panel leans back and straightens as the page scrolls. The stage is drawn at one
// size and scaled to the screen; on phones the app alone is the picture. SpaceIntro follows: the tools it
// works with, on one quiet line.
import { motion, useMotionValueEvent, useScroll, useTransform } from "motion/react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { FolderOpen, Mail, Menu, MessageCircle, Video, X } from "lucide-react";
import NetworkIcon from "@/components/network-icon";
import { useI18n } from "@/lib/i18n/locale-provider";
import LanguageSwitch from "@/components/language-switch";
import { trialDays } from "@/lib/plans";
import { DeepPanel, useStill } from "./ui";
import { PlanetLink } from "./windows";
import "./space.css";

const whatsappNumber = "212607484822";
export const whatsappLink = (text: string) => `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(text)}`;
export type Cta = { href: string; label: string; external: boolean };
export const outward = (cta: Cta) => (cta.external ? { target: "_blank", rel: "noopener noreferrer" } : {});

export function useCta(signup: boolean): Cta {
  const { t } = useI18n();
  return signup
    ? { href: "/login?mode=signup", label: t("Essayer {days} jours", { days: trialDays }), external: false }
    : { href: whatsappLink(t("Bonjour, je souhaite une démo de The One Space pour mon agence.")), label: t("Demander une démo"), external: true };
}

/** Scales the stage (drawn at 1100 px) to the width it is given. */
function useStageScale(ref: RefObject<HTMLDivElement | null>) {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, el.clientWidth / 1100));
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, [ref]);
  return scale;
}

/** The real app on the silver panel, and the approval receipt that the seal stamps once. */
function Stage({ hero }: { hero: RefObject<HTMLElement | null> }) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const scale = useStageScale(box);
  const still = useStill();
  const { scrollYProgress } = useScroll({ target: hero, offset: ["start start", "end start"] });
  const lean = useTransform(scrollYProgress, [0, 0.5], [10, 0]);
  const receiptY = useTransform(scrollYProgress, [0, 1], [0, -110]);
  return (
    <div className="ts-stage-box" ref={box} style={{ "--s": scale } as React.CSSProperties} aria-hidden="true">
      <div className="ts-stage" dir="ltr">
        <motion.div className="ts-show" style={{ rotateX: still ? 0 : lean, transformPerspective: 2400 }}>
          <DeepPanel tone="silver" className="ts-show-panel"><div className="ts-app">
            <div className="ts-app-top"><span className="ts-dots"><i /><i /><i /></span><span className="ts-app-url">space.the1core.com</span></div>
            {/* eslint-disable-next-line @next/next/no-img-element -- static screenshot, sized by CSS */}
            <img className="ts-app-shot" src="/landing/dashboard.webp" alt="" width={1600} height={1000} />
          </div></DeepPanel>
        </motion.div>
        <motion.div className="ts-receipt-wrap" style={{ y: still ? 0 : receiptY }}><div className="ts-receipt">
          <div className="ts-r-h">THE ONE SPACE</div><div className="ts-r-c">{t("REÇU DE VALIDATION N° 0412")}</div><hr />
          <div className="ts-r-row"><span>{t("Client")}</span><span>Café Atlas</span></div>
          <div className="ts-r-row"><span>{t("Contenu")}</span><span>{t("Menu d’automne")}</span></div>
          <div className="ts-r-row"><span>{t("Version")}</span><span>v1 · {t("tour 0/2")}</span></div>
          <div className="ts-r-row"><span>{t("Envoyé")}</span><span>{t("mar. 10:12")}</span></div>
          <div className="ts-r-row"><span>{t("Validé par")}</span><span>Karim B.</span></div>
          <div className="ts-r-row"><span>{t("Depuis")}</span><span>{t("iPhone · portail")}</span></div><hr />
          <b>{t("VALIDÉ")}</b> · {t("mar. 14:38 · 4 h 26")}<br /><span className="ts-r-muted">{t("Programmé · IG · lun. 09:00")}</span>
          <div className="ts-seal">
            {/* eslint-disable-next-line @next/next/no-img-element -- SVG mark */}
            <img src="/favicon.svg" alt="" /><span>{t("VALIDÉ")}</span>
          </div>
        </div></motion.div>
      </div>
    </div>
  );
}

/** The floating capsule navigation: a gold highlight follows the pointer; it tightens once you scroll. */
function TopBar({ cta }: { cta: Cta }) {
  const { t } = useI18n();
  const [menu, setMenu] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [tight, setTight] = useState(false);
  const { scrollY } = useScroll();
  useMotionValueEvent(scrollY, "change", (y) => setTight(y > 40));
  const links: { id: string; node: React.ReactNode }[] = [
    { id: "produit", node: <a href="#produit" onClick={() => setMenu(false)}>{t("Produit")}</a> },
    { id: "methode", node: <PlanetLink slug="methode" onOpen={() => setMenu(false)}>{t("La méthode")}</PlanetLink> },
    { id: "tarifs", node: <a href="#tarifs" onClick={() => setMenu(false)}>{t("Tarifs")}</a> },
    { id: "questions", node: <a href="#questions" onClick={() => setMenu(false)}>{t("Questions")}</a> },
  ];
  return (
    <header className={`ts-top${tight ? " tight" : ""}`}>
      <div className="ts-capsule">
        <a href="#" className="ts-brand" aria-label="The One Space">
          {/* eslint-disable-next-line @next/next/no-img-element -- SVG mark */}
          <img src="/favicon.svg" alt="" width={26} height={26} /><span>The One Space</span>
        </a>
        <nav className={`ts-menu${menu ? " open" : ""}`} aria-label={t("Navigation")} onPointerLeave={() => setHover(null)}>
          {links.map(({ id, node }) => (
            <span key={id} className="ts-menu-item" onPointerEnter={() => setHover(id)}>
              {hover === id && <motion.span layoutId="ts-nav-hl" className="ts-nav-hl" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
              {node}
            </span>
          ))}
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

export default function SpaceHero({ cta }: { cta: Cta }) {
  const { t } = useI18n();
  const hero = useRef<HTMLElement>(null);
  return (
    <>
      <TopBar cta={cta} />
      <section ref={hero} className="ts-hero" aria-labelledby="ts-title">
        <div className="ts-beam" aria-hidden="true" />
        <div className="ts-wrap ts-hero-grid">
          <div>
            <p className="ts-eyebrow"><span>{t("Pour les agences social media")}</span>{t("et leurs clients")}</p>
            <h1 id="ts-title">{t("Produisez, faites valider et publiez le contenu de vos clients")}</h1>
          </div>
          <div className="ts-hero-side">
            <p className="ts-hero-lead">{t("Un seul espace pour votre équipe et vos clients. Et une règle que le logiciel fait respecter : sans réponse en 48 h, c’est validé, avec un reçu daté.")}</p>
            <div className="ts-hero-cta">
              <a className="ts-btn gold" href={cta.href} {...outward(cta)}>{cta.label}</a>
              <a className="ts-btn ink" href="#produit">{t("Voir le produit")}</a>
            </div>
            <p className="ts-micro">{t("{days} jours gratuits, sans carte bancaire", { days: trialDays })}</p>
          </div>
        </div>
        <Stage hero={hero} />
      </section>
    </>
  );
}

/** Right after the hero: the tools it works with, on one quiet line. TikTok and YouTube are not live yet. */
export function SpaceIntro() {
  const { t } = useI18n();
  return (
    <section className="ts-intro" aria-label={t("Fonctionne avec")}>
      <ul className="ts-wrap ts-tools-line">
        <li className="lead">{t("Fonctionne avec")}</li>
        <li><NetworkIcon network="instagram" size={18} />Instagram</li>
        <li><NetworkIcon network="facebook" size={18} />Facebook</li>
        <li><MessageCircle size={18} aria-hidden="true" />WhatsApp</li>
        <li><FolderOpen size={18} aria-hidden="true" />Google Drive</li>
        <li><Mail size={18} aria-hidden="true" />{t("E-mail")}</li>
        <li><Video size={18} aria-hidden="true" />{t("Visio")}</li>
        <li className="soon"><NetworkIcon network="tiktok" size={18} />TikTok<em>{t("bientôt")}</em></li>
        <li className="soon"><NetworkIcon network="youtube" size={18} />YouTube<em>{t("bientôt")}</em></li>
      </ul>
    </section>
  );
}
