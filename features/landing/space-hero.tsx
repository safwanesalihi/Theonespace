"use client";
// The top of the public page, for agencies that buy software: a floating capsule navigation, a plain
// headline that says what the product does, the one rule that sets it apart (no answer in 48 h and the
// content is approved, with a dated receipt), two calls to action, and the real app — screenshots with
// sample data, switched by tabs — on a brushed-silver panel with the client's phone, the approval receipt
// and one reel's timeline around it. The panel leans back and straightens as the page scrolls. The stage
// is drawn at one size and scaled to the screen; on phones only the phone and the receipt remain.
// SpaceIntro follows: the tools it connects to.
import { motion, useMotionValueEvent, useScroll, useTransform } from "motion/react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { ArrowRight, FolderOpen, Mail, Menu, MessageCircle, Video, X } from "lucide-react";
import NetworkIcon from "@/components/network-icon";
import { useI18n } from "@/lib/i18n/locale-provider";
import LanguageSwitch from "@/components/language-switch";
import { trialDays } from "@/lib/plans";
import { DeepPanel, useCountdown, useStill } from "./ui";
import { PlanetLink } from "./windows";
import "./space.css";

const whatsappNumber = "212607484822";
export const whatsappLink = (text: string) => `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(text)}`;
export type Cta = { href: string; label: string; external: boolean };

export function useCta(signup: boolean): Cta {
  const { t } = useI18n();
  return signup
    ? { href: "/login?mode=signup", label: t("Essayer {days} jours", { days: trialDays }), external: false }
    : { href: whatsappLink(t("Bonjour, je souhaite une démo de The One Space pour mon agence.")), label: t("Demander une démo"), external: true };
}

/** Scales the stage (drawn at 1100 px) to the width it is given, at most 84 % so the hero fits one screen. */
function useStageScale(ref: RefObject<HTMLDivElement | null>) {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => setScale(Math.min(0.84, el.clientWidth / 1100));
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, [ref]);
  return scale;
}

/** One reel's way to approval, as the studio sees it: sent, alerted, reminded, approved at 48 h. */
function Journey() {
  const { t } = useI18n();
  const steps: [string, string, "done" | "now" | "next" | "end"][] = [
    [t("Envoyé au client"), t("mar. 10:12"), "done"],
    [t("Alerte WhatsApp"), t("mar. 10:12"), "done"],
    [t("Rappel"), t("reste 24 h"), "now"],
    [t("Dernier rappel"), t("reste 6 h"), "next"],
    [t("Validé d’office"), t("à 48 h"), "end"],
  ];
  return (
    <div className="ts-journey">
      <div className="ts-j-head"><span className="ts-art reel ts-j-thumb"><i>▶</i></span><div><b>{t("Reel lancement · v2")}</b><span>Café Atlas · Studio Nour</span></div></div>
      <ol className="ts-j-steps">{steps.map(([label, when, state]) => <li key={label} className={state}><i /><span>{label}</span><em>{when}</em></li>)}</ol>
      <div className="ts-j-foot"><span>{t("Retouches")}</span><span className="ts-j-pips"><i className="on" /><i /></span><b>1/2</b></div>
    </div>
  );
}

/** The real app, as screenshots with sample data (public/landing/*.webp), switched by the tabs above it. */
export const shots = [
  { id: "dashboard", label: "Tableau de bord" },
  { id: "board", label: "Tâches" },
  { id: "clients", label: "Clients" },
  { id: "portal", label: "Portail client" },
] as const;

function Stage({ hero, shot }: { hero: RefObject<HTMLElement | null>; shot: number }) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const scale = useStageScale(box);
  const still = useStill();
  const { hh, mm } = useCountdown();
  const { scrollYProgress } = useScroll({ target: hero, offset: ["start start", "end start"] });
  const lean = useTransform(scrollYProgress, [0, 0.55], [14, 0]);
  const phoneY = useTransform(scrollYProgress, [0, 1], [0, -70]);
  const receiptY = useTransform(scrollYProgress, [0, 1], [0, -130]);
  const journeyY = useTransform(scrollYProgress, [0, 1], [0, -100]);
  return (
    <div className="ts-stage-box" ref={box} style={{ "--s": scale } as React.CSSProperties} aria-hidden="true">
      <div className="ts-stage" dir="ltr">
        <motion.div className="ts-show" style={{ rotateX: still ? 0 : lean, transformPerspective: 2200 }}>
          <DeepPanel tone="silver" className="ts-show-panel"><div className="ts-app">
            <div className="ts-app-top"><span className="ts-dots"><i /><i /><i /></span><span className="ts-app-url">space.the1core.com</span></div>
            {/* eslint-disable-next-line @next/next/no-img-element -- static screenshots, sized by CSS */}
            <img key={shots[shot].id} className="ts-app-shot" src={`/landing/${shots[shot].id}.webp`} alt="" width={1600} height={1000} />
          </div></DeepPanel>
        </motion.div>

        <motion.div className="ts-phone-wrap" style={{ y: still ? 0 : phoneY }}><div className="ts-phone"><div className="ts-screen"><div className="ts-notch" />
          <div className="ts-notif"><span className="ts-wa">✓</span><div><b>Studio Nour · WhatsApp</b><br />{t("Votre reel « Le lancement » est prêt à valider.")}</div></div>
          <div className="ts-portal"><div className="ts-portal-head"><i>SN</i>Studio Nour · Café Atlas</div>
            <div className="ts-art reel ts-portal-post"><i>▶</i><b>Le lancement</b></div>
            <div className="ts-portal-clock"><span>{t("Validation tacite dans")}</span><b>{hh} h {mm}</b></div>
            <div className="ts-portal-btns"><span>{t("Retouche · 1/2")}</span><span className="go">{t("Valider")}</span></div></div>
        </div></div></motion.div>

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

        <motion.div className="ts-journey-wrap" style={{ y: still ? 0 : journeyY }}><Journey /></motion.div>
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
          <a className="ts-pill" href={cta.href} {...(cta.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{cta.label}</a>
          <button type="button" className="ts-burger" aria-label={t("Menu")} aria-expanded={menu} onClick={() => setMenu(!menu)}>{menu ? <X size={20} /> : <Menu size={20} />}</button>
        </div>
      </div>
    </header>
  );
}

export default function SpaceHero({ cta }: { cta: Cta }) {
  const { t } = useI18n();
  const hero = useRef<HTMLElement>(null);
  const [shot, setShot] = useState(0);
  return (
    <>
      <TopBar cta={cta} />
      <section ref={hero} className="ts-hero" aria-labelledby="ts-title">
        <div className="ts-beam" aria-hidden="true" />
        <div className="ts-floor" aria-hidden="true" />
        <div className="ts-head">
          <p className="ts-eyebrow"><span>{t("Pour les agences social media")}</span>{t("et leurs clients")}</p>
          <h1 id="ts-title">{t("Produisez, faites valider et publiez le contenu de vos clients")}</h1>
          <p className="ts-hero-lead">{t("Un seul espace pour votre équipe et vos clients. Et une règle que le logiciel fait respecter : sans réponse en 48 h, c’est validé, avec un reçu daté.")}</p>
          <div className="ts-hero-cta">
            <a className="ts-btn gold" href={cta.href} {...(cta.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{cta.label} <ArrowRight size={16} className="os-arrow" aria-hidden="true" /></a>
            <PlanetLink slug="methode" className="ts-btn ink">{t("Voir la méthode")}</PlanetLink>
          </div>
          <p className="ts-micro">{t("{days} jours gratuits · Sans carte bancaire", { days: trialDays })}</p>
        </div>
        <div className="ts-wrap ts-shot-tabs" id="produit" role="tablist" aria-label={t("Aperçu de l’application")}>
          {shots.map((s, i) => <button key={s.id} type="button" role="tab" aria-selected={shot === i} className={shot === i ? "on" : ""} onClick={() => setShot(i)}>{t(s.label)}</button>)}
        </div>
        <Stage hero={hero} shot={shot} />
      </section>
    </>
  );
}

/** Right after the hero: the tools the studio already uses, connected. TikTok and YouTube are not live yet. */
export function SpaceIntro() {
  const { t } = useI18n();
  return (
    <section className="ts-intro ts-sheet" aria-labelledby="ts-intro-title">
      <div className="ts-wrap">
        <p className="ts-label ts-center-label" id="ts-intro-title">{t("Connecté aux outils que vous utilisez déjà")}</p>
        <ul className="ts-tools">
          <li><NetworkIcon network="instagram" size={20} />Instagram</li>
          <li><NetworkIcon network="facebook" size={20} />Facebook</li>
          <li><MessageCircle size={20} aria-hidden="true" />WhatsApp</li>
          <li><FolderOpen size={20} aria-hidden="true" />Google Drive</li>
          <li><Mail size={20} aria-hidden="true" />{t("E-mail")}</li>
          <li><Video size={20} aria-hidden="true" />{t("Visio")}</li>
          <li className="soon"><NetworkIcon network="tiktok" size={20} />TikTok<em>{t("bientôt")}</em></li>
          <li className="soon"><NetworkIcon network="youtube" size={20} />YouTube<em>{t("bientôt")}</em></li>
        </ul>
      </div>
    </section>
  );
}
