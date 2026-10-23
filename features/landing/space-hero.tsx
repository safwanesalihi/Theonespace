"use client";
// The top of the public page: a floating capsule navigation, the proverb « Qui ne dit mot, consent » (the
// product enforces it: no answer in 48 h and the content is approved), two round calls to action, and the
// "stage" on a brushed-silver panel with moving satin: the studio's app with one client's validations and
// week, the client's phone with the WhatsApp alert, the approval receipt sealed with The One Core's mark,
// and the reel's timeline of reminders. Clocks really run. The panel leans back and straightens as the
// page scrolls; the phone, the receipt and the timeline drift at their own pace. The stage is drawn at one
// size and scaled to the screen; on phones only the phone and the receipt remain. Names on the stage
// (Studio Nour, Café Atlas…) are sample data. SpaceIntro follows.
import { motion, useMotionValueEvent, useScroll, useTransform } from "motion/react";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { Menu, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/locale-provider";
import LanguageSwitch from "@/components/language-switch";
import { trialDays } from "@/lib/plans";
import type { PlanetSlug } from "./planets";
import { landingFonts } from "./fonts";
import { CountUp, DeepPanel, DepthCard, LiveClock, Reveal, useCountdown, useStill } from "./ui";
import { Dock, PlanetLink } from "./windows";
import "./space.css";

const whatsappNumber = "212607484822";
export const whatsappLink = (text: string) => `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(text)}`;
export type Cta = { href: string; label: string; ring: string; external: boolean };

export function useCta(signup: boolean): Cta {
  const { t } = useI18n();
  return signup
    ? { href: "/login?mode=signup", label: t("Essayer {days} jours", { days: trialDays }), ring: t("Essayer {days} jours · gratuit", { days: trialDays }), external: false }
    : { href: whatsappLink(t("Bonjour, je souhaite une démo de The One Space pour mon agence.")), label: t("Demander une démo"), ring: t("Demander une démo · WhatsApp"), external: true };
}

/** A round call to action: a dot in the middle and its label turning slowly around it. */
export function Orb({ href, planet, external, label, glyph, tone }: { href?: string; planet?: PlanetSlug; external?: boolean; label: string; glyph: string; tone: "light" | "dark" | "gold" }) {
  const id = useId();
  const { rtl } = useI18n();
  // Short labels go round twice. Latin text is stretched to exactly one turn (2π × 46 ≈ 289); Arabic
  // keeps its natural spacing, since extra spacing would break the joined letters.
  const turns = rtl ? Math.max(1, Math.round(54 / (label.length + 3))) : label.length < 20 ? 2 : 1;
  const ring = `${label} · `.repeat(turns);
  const inner = (
    <>
      <svg className="ts-orb-ring" viewBox="0 0 120 120" aria-hidden="true">
        <defs><path id={id} d="M60,60 m-46,0 a46,46 0 1,1 92,0 a46,46 0 1,1 -92,0" /></defs>
        <text><textPath href={`#${id}`} {...(rtl ? {} : { textLength: 286, lengthAdjust: "spacing" })}>{ring.toUpperCase()}</textPath></text>
      </svg>
      <b aria-hidden="true">{glyph}</b>
      <span className="ts-sr">{label}</span>
    </>
  );
  if (planet) return <PlanetLink slug={planet} className={`ts-orb ${tone}`}>{inner}</PlanetLink>;
  return <a className={`ts-orb ${tone}`} href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{inner}</a>;
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

const posters = [
  { kind: "Instagram · Post", title: "Menu d’automne", status: "Validé · reçu signé", tone: "done", art: "menu" },
  { kind: "Reel · 0:28", title: "Reel lancement · v2", status: "", tone: "clock", art: "reel" },
  { kind: "Story", title: "Story promo", status: "Retouche · tour 1/2", tone: "round", art: "promo" },
  { kind: "Carrousel · 5", title: "Carrousel barista", status: "Programmé · ven. 18:00", tone: "planned", art: "barista" },
] as const;

function Poster({ art }: { art: (typeof posters)[number]["art"] }) {
  if (art === "menu") return <div className="ts-art menu"><b>NOUVEAU<br />MENU</b><small>dès lundi · 9 h</small></div>;
  if (art === "reel") return <div className="ts-art reel"><i aria-hidden="true">▶</i><b>Le lancement</b></div>;
  if (art === "promo") return <div className="ts-art promo"><b>-20%</b><small>CE WEEK-END</small></div>;
  return <div className="ts-art barista"><b>5 secrets<br /><em>du barista</em></b></div>;
}

/** The studio's app: one client's validations and week, with the reel's clock really running. */
function App() {
  const { t } = useI18n();
  const days = [["Lun 20", "Menu automne", "a"], ["Mar 21", "Story coulisses", "b"], ["Mer 22", "Story -20%", "a"], ["Jeu 23", "Post avis", "b"], ["Ven 24", "Reel lancement", "d"], ["Sam 25", "+ idée", "e"], ["Dim 26", "", ""]];
  return (
    <div className="ts-app">
      <div className="ts-app-top"><span className="ts-dots"><i /><i /><i /></span><span className="ts-search">⌕ {t("Rechercher un client, un contenu…")}</span><span>Studio Nour · Casablanca</span>
        <span className="ts-avs"><i>S</i><i>Y</i><i>K</i><i className="more">+3</i></span></div>
      <div className="ts-app-body">
        <div className="ts-side">
          <div className="ts-side-brand">
            {/* eslint-disable-next-line @next/next/no-img-element -- SVG mark */}
            <img src="/favicon.svg" alt="" />The One Space
          </div>
          <div className="ts-it on"><i />{t("À valider")}<em>3</em></div>
          <div className="ts-it"><i />{t("Calendrier")}</div><div className="ts-it"><i />{t("Fichiers")}</div><div className="ts-it"><i />{t("Publication")}</div><div className="ts-it"><i />{t("Devis et factures")}</div><div className="ts-it"><i />One</div>
          <div className="ts-side-label">{t("Clients")}</div>
          {["Café Atlas", "Nour Beauty", "Riad 22", "Atlas Gym"].map((n, i) => <div key={n} className={`ts-it${i === 0 ? " pick" : ""}`}><i />{n}</div>)}
        </div>
        <div className="ts-main">
          <div className="ts-main-head"><div><h3>Café Atlas</h3><p>{t("Octobre · 12 contenus · 9 validés · 0 en retard")}</p></div>
            <div className="ts-tabs"><span className="on">{t("Validation")}</span><span>{t("Calendrier")}</span><span>{t("Fichiers")}</span></div></div>
          <div className="ts-cards">
            {posters.map((p) => (
              <div key={p.art} className="ts-card"><div className="ts-post"><span className="ts-net">{p.kind}</span><Poster art={p.art} /></div>
                <div className="ts-card-info"><b>{p.title}</b><span className={`ts-st ${p.tone}`}>{p.tone === "clock" ? <>⏱ <LiveClock className="ts-st-time" /></> : t(p.status)}</span></div></div>
            ))}
          </div>
          <div className="ts-week"><div className="ts-week-head"><span>{t("Semaine du 20 octobre")}</span><span>{t("Glisser pour reprogrammer")}</span></div>
            <div className="ts-days"><div className="ts-lock"><span>🔒 {t("Gelé · J−7")}</span></div>
              {days.map(([d, ev, c]) => <div key={d} className="ts-day"><b>{d}</b>{ev && <span className={`ts-ev ${c}`}>{ev}</span>}{d === "Ven 24" && <span className="ts-ev b">Carrousel</span>}</div>)}
            </div></div>
        </div>
      </div>
    </div>
  );
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

function Stage({ hero }: { hero: RefObject<HTMLElement | null> }) {
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
          <DeepPanel tone="silver" className="ts-show-panel"><App /></DeepPanel>
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
    { id: "methode", node: <PlanetLink slug="methode" onOpen={() => setMenu(false)}>{t("La méthode")}</PlanetLink> },
    { id: "portail", node: <PlanetLink slug="portail" onOpen={() => setMenu(false)}>{t("Portail client")}</PlanetLink> },
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
  return (
    <div className={landingFonts}>
      <TopBar cta={cta} />
      <section ref={hero} className="ts-hero" aria-labelledby="ts-title">
        <div className="ts-beam" aria-hidden="true" />
        <div className="ts-floor" aria-hidden="true" />
        <div className="ts-head">
          <h1 id="ts-title">{t("Qui ne dit mot,")} <span className="ts-ring">{t("consent")}<svg viewBox="0 0 400 130" preserveAspectRatio="none" aria-hidden="true"><path d="M18 70 C 20 18, 360 8, 384 58 C 400 100, 120 128, 40 104 C 8 94, 12 60, 70 40" /></svg></span>.</h1>
          <p className="ts-kicker">{t("— en 48 heures, c’est validé.")}</p>
          <div className="ts-orbs">
            <div className="ts-orb-wrap start"><Orb planet="methode" label={t("Voir la méthode")} glyph="▶" tone="light" /><span className="ts-hand">↑ {t("voir la méthode")}</span></div>
            <div className="ts-orb-wrap end"><Orb href={cta.href} external={cta.external} label={cta.ring} glyph="→" tone="gold" /><span className="ts-hand">↑ {cta.label.toLowerCase()}</span></div>
          </div>
        </div>
        <Stage hero={hero} />
      </section>
      <Dock hero={hero} />
    </div>
  );
}

/** Right after the hero: what The One Space is, in plain words and four facts the product keeps. */
export function SpaceIntro() {
  const { t } = useI18n();
  // The facts are the product's own rules (lib/workflow-settings.ts, lib/flow.ts) and the client portal.
  const facts = [
    { n: 48, fmt: (v: number) => `${Math.round(v)} h`, title: t("pour valider"), text: t("Sans réponse, c’est validé, avec un reçu daté.") },
    { n: 2, fmt: (v: number) => String(Math.round(v)), title: t("tours de retouche"), text: t("Inclus dans chaque contenu. Le troisième se facture.") },
    { n: 7, fmt: (v: number) => `J−${Math.round(v)}`, title: t("calendrier gelé"), text: t("Plus de changement de dernière minute la semaine de la publication.") },
    { n: 0, fmt: () => "0", title: t("installation"), text: t("Vos clients valident depuis leur téléphone, dans leur navigateur.") },
  ];
  return (
    <section className={`ts-intro ts-sheet ${landingFonts}`} aria-labelledby="ts-intro-title">
      <div className="ts-wrap">
        <Reveal><p className="ts-label">The One Space</p>
          <h2 id="ts-intro-title" className="ts-h2">{t("Le logiciel des agences social media,")} <em>{t("et de leurs clients.")}</em></h2>
          <p className="ts-lead">{t("Briefs, fichiers, validations, calendrier, publication Facebook et Instagram, devis et factures : tout ce que vous faisiez sur huit outils, dans un seul espace, avec des règles que le logiciel fait respecter.")}</p></Reveal>
        <div className="ts-facts">
          {facts.map((f, i) => (
            <Reveal key={f.title} delay={i * 0.08}><DepthCard className="ts-fact glass">
              <b className="ts-gold-text">{f.n ? <CountUp to={f.n} format={f.fmt} /> : f.fmt(0)}</b><h3>{f.title}</h3><p>{f.text}</p>
            </DepthCard></Reveal>
          ))}
        </div>
        <p className="ts-intro-foot"><span>{t("Français · English · العربية")}</span><span>{t("Prix en dirhams")}</span><span>{t("Fait à Berrechid par The One Core")}</span></p>
      </div>
    </section>
  );
}
