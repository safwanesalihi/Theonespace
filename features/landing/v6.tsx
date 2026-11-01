"use client";
// The public page, for marketing agencies that buy software: the real app, large, on V2's brushed-silver
// panel, then one idea per screen — the six tools it replaces, the agency's own method (built in five
// questions), the rules it keeps, the client's side, the agency's numbers, the rest of the everyday, the
// pilot call, the questions and the footer. Every picture is a real screen of the app with demo data
// (public/landing/v6). Gold moves only for the decision: the stamp that strikes once on the hero's phone,
// and the one the visitor strikes on the client's cards. The effects come from React Bits (fx/): the
// headline out of a blur, gold light falling on the hero (wide screens only), the endless row of networks.
import Image from "next/image";
import dynamic from "next/dynamic";
import { motion, useInView, useMotionValueEvent, useScroll, useTransform } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Bot, Check, Database, Globe, Languages, LayoutGrid, Mail, Menu, MessageCircle, Phone, Send, ShieldCheck, X } from "lucide-react";
import NetworkIcon from "@/components/network-icon";
import LanguageSwitch from "@/components/language-switch";
import { Stamp } from "@/components/moments/stamp";
import { useI18n } from "@/lib/i18n/locale-provider";
import { company } from "./company";
import { CountUp, DeepPanel, DepthCard, LiveClock, useRich, useStill } from "./ui";
import BlurText from "./fx/blur-text";
import LogoLoop from "./fx/logo-loop";
import ClientDeck from "./deck";
import type { GatherTool } from "./fx/gather";

const GatherStage = dynamic(() => import("./gather-stage"), { ssr: false });
const Builder = dynamic(() => import("./builder"), { ssr: false });

const whatsappNumber = "212607484822";
const whatsappLink = (text: string) => `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(text)}`;
export type Cta = { href: string; label: string; external: boolean };
const outward = (cta: Cta) => (cta.external ? { target: "_blank", rel: "noopener noreferrer" } : {});

/** « Devenir agence pilote »: the sign-up form when it is open, otherwise a WhatsApp message to The One Core. */
export function useCta(signup: boolean): Cta {
  const { t } = useI18n();
  return signup
    ? { href: "/login?mode=signup", label: t("Devenir agence pilote"), external: false }
    : { href: whatsappLink(t("Bonjour, notre agence aimerait devenir agence pilote de The One Space.")), label: t("Devenir agence pilote"), external: true };
}

/** A real screen of the app in a light browser frame. */
function Screen({ src, alt, priority = false, className = "" }: { src: string; alt: string; priority?: boolean; className?: string }) {
  return (
    <figure className={`v6-screen ${className}`}>
      <div className="v6-screen-bar" aria-hidden="true"><i /><i /><i /><span>space.the1core.com</span></div>
      <Image src={src} alt={alt} width={1920} height={1200} sizes="(max-width: 900px) 100vw, 1200px" priority={priority} />
    </figure>
  );
}

/** A real phone screen of the app. */
function PhoneShot({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  return (
    <figure className={`v6-phone ${className}`}>
      <Image src={src} alt={alt} width={780} height={1688} sizes="(max-width: 900px) 46vw, 300px" />
    </figure>
  );
}

function Head({ id, title, lead }: { id: string; title: string; lead?: string }) {
  return (
    <div className="v6-head">
      <h2 id={id}>{title}</h2>
      {lead && <p>{lead}</p>}
    </div>
  );
}

function TopBar({ cta }: { cta: Cta }) {
  const { t } = useI18n();
  const [menu, setMenu] = useState(false);
  const [tight, setTight] = useState(false);
  const { scrollY } = useScroll();
  useMotionValueEvent(scrollY, "change", (y) => setTight(y > 40));
  const links = [["#methode", t("Votre méthode")], ["#regles", t("Vos règles")], ["#client", t("Côté client")], ["#questions", t("Questions")]];
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

/** The hero: what it is, for whom, the rule that sets it apart, and the real app as large as the screen
 *  allows. The panel leans back and straightens as the page scrolls; once the page has settled the stamp
 *  strikes on the phone and the receipt line comes up — the page's one orchestrated moment. */
function Hero({ cta }: { cta: Cta }) {
  const { t } = useI18n();
  const still = useStill();
  const stage = useRef<HTMLDivElement>(null);
  const [stamped, setStamped] = useState(false);
  useEffect(() => {
    const go = setTimeout(() => setStamped(true), still ? 0 : 1700);
    return () => clearTimeout(go);
  }, [still]);
  const { scrollYProgress } = useScroll({ target: stage, offset: ["start end", "center center"] });
  const lean = useTransform(scrollYProgress, [0, 1], [14, 0]);
  const lift = useTransform(scrollYProgress, [0, 1], [40, 0]);
  return (
    <section className="v6-hero" aria-labelledby="v6-title">
      <div className="v6-rays" aria-hidden="true" />
      <div className="v6-hero-head">
        <p className="v6-for">{t("Pour les agences social media, contenu, vidéo et branding")}</p>
        <h1 id="v6-title"><BlurText text={t("Le logiciel des agences marketing.")} delay={0.15} /></h1>
        <p className="v6-lead">{t("Votre méthode, vos relectures, et des clients qui valident depuis leur téléphone. Sans réponse en 48 h, c’est validé, avec un reçu daté.")}</p>
        <div className="v6-ctas">
          <a className="v6-btn gold" href={cta.href} {...outward(cta)}>{cta.label}</a>
          <a className="v6-btn line" href="#methode">{t("Voir l’espace")}</a>
        </div>
      </div>
      <div className="v6-stage" ref={stage}>
        <motion.div className="v6-tilt" style={still ? undefined : { rotateX: lean, y: lift, transformPerspective: 2400 }}>
          <DeepPanel tone="silver" className="v6-panel">
            <Screen src="/landing/v6/01-accueil.webp" alt={t("L’accueil de l’espace : la priorité du jour et les contenus en attente du client")} priority />
          </DeepPanel>
        </motion.div>
        <div className="v6-hero-phone">
          <PhoneShot src="/landing/v6/04-tache-chez-le-client-phone.webp" alt={t("Un livrable chez le client, avec le temps qu’il lui reste pour répondre")} />
          <span className="v6-hero-stamp">{stamped && <Stamp play size={84} />}</span>
        </div>
        <motion.p className="v6-receipt-line" initial={false} animate={stamped ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }} transition={{ delay: still ? 0 : 0.35, duration: 0.4 }} aria-live="polite">
          <Check size={15} aria-hidden="true" /><span>{t("Café Atlas a validé « Carrousel 3 spots ». Reçu n° 0412 ajouté à l’historique.")}</span>
        </motion.p>
      </div>
    </section>
  );
}

/** The networks and channels it works with, as an endless row. */
function WorksWith() {
  const { t } = useI18n();
  const items = [
    { key: "ig", node: <><NetworkIcon network="instagram" size={22} />Instagram</> },
    { key: "fb", node: <><NetworkIcon network="facebook" size={22} />Facebook</> },
    { key: "tt", node: <><NetworkIcon network="tiktok" size={22} />TikTok</> },
    { key: "yt", node: <><NetworkIcon network="youtube" size={22} />YouTube</> },
    { key: "wa", node: <><MessageCircle size={22} aria-hidden="true" />WhatsApp</> },
    { key: "mail", node: <><Mail size={22} aria-hidden="true" />{t("E-mail")}</> },
  ];
  return (
    <section className="v6-with" aria-labelledby="v6-with">
      <p id="v6-with" className="v6-with-lead">{t("Publie et prévient sur")}</p>
      {/* Twice over, so one row is wider than the widest screen and the loop never shows its end. */}
      <LogoLoop items={[...items, ...items.map((i) => ({ ...i, key: `${i.key}-2` }))]} label={t("Fonctionne avec")} />
    </section>
  );
}

/** The agency's week today, then one space where each tool becomes a module (V2's hub). As the drawing
 *  comes into view it plays from mess to order: the six tools fall in askew and their threads tangle, then
 *  the space lights up in the middle and each tool comes back as a module, one after another. */
function Tangle() {
  const { t } = useI18n();
  const still = useStill();
  const rich = useRich();
  const box = useRef<HTMLDivElement>(null);
  const seen = useInView(box, { once: true, amount: 0.35 });
  const on = still || seen;
  const at = (delay: number, duration = 0.5) => (still ? { duration: 0 } : { delay, duration, ease: [0.2, 0.8, 0.2, 1] as const });
  const today = [
    { cls: "wa", name: "WhatsApp", pain: t("47 messages non lus"), x: 24, y: 15, rot: -4 },
    { cls: "mail", name: t("E-mail"), pain: t("6 jours sans réponse"), x: 74, y: 22, rot: 3 },
    { cls: "drive", name: "Drive", pain: "reel_FINAL_vrai(1).mp4", x: 30, y: 49, rot: 2 },
    { cls: "sheet", name: "Excel", pain: t("Calendrier v4 · ???"), x: 76, y: 56, rot: -3 },
    { cls: "doc", name: t("Facture"), pain: t("Tour 4 sur 2 · non facturé"), x: 22, y: 84, rot: 3 },
    { cls: "design", name: t("Design"), pain: t("Story promo · v7"), x: 72, y: 86, rot: -2 },
  ];
  const threads = ["M24 15 C 70 30, 10 60, 76 56", "M74 22 C 20 30, 70 70, 22 84", "M30 49 C 60 10, 90 90, 72 86", "M24 15 C 40 70, 60 20, 72 86", "M76 56 C 40 40, 50 95, 22 84", "M74 22 C 90 50, 10 40, 30 49"];
  const hub = [
    { name: t("Portail client"), from: "WhatsApp", x: 50, y: 11 },
    { name: t("Validation en 48 h"), from: t("E-mail"), x: 83, y: 31 },
    { name: t("Fichiers et versions"), from: "Drive", x: 83, y: 69 },
    { name: t("Calendrier gelé"), from: "Excel", x: 50, y: 89 },
    { name: t("Tours comptés"), from: t("Facture"), x: 17, y: 69 },
    { name: t("Tâches et retours"), from: t("Design"), x: 17, y: 31 },
  ];
  return (
    <section className="v6-sec" aria-labelledby="v6-tangle">
      <div className="ts-wrap">
        <Head id="v6-tangle" title={t("Six outils qui ne se parlent pas. Un espace où tout se répond.")} />
        {rich ? <Gathered today={today} hub={hub} /> : <div className="ts-hubs" ref={box}>
          <figure className="ts-hub-panel ts-glass">
            <figcaption><span className="ts-hub-tag bad">{t("Aujourd’hui")}</span><b>{t("6 outils · 0 règle")}</b></figcaption>
            <div className="ts-hub-box">
              <svg className="ts-threads" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{threads.map((d, i) => <motion.path key={d} d={d} vectorEffect="non-scaling-stroke" initial={false} animate={{ pathLength: on ? 1 : 0, opacity: on ? 1 : 0 }} transition={at(0.5 + i * 0.12, 0.9)} />)}</svg>
              {today.map((tool, i) => <motion.div key={tool.cls} className={`ts-mess ${tool.cls}`} style={{ left: `${tool.x}%`, top: `${tool.y}%`, x: "-50%", y: "-50%" }} initial={false} animate={on ? { opacity: 1, scale: 1, rotate: tool.rot } : { opacity: 0, scale: 0.8, rotate: tool.rot * 5 }} transition={still ? { duration: 0 } : { delay: i * 0.08, type: "spring", stiffness: 260, damping: 18 }}><b><i aria-hidden="true" />{tool.name}</b><span>{tool.pain}</span></motion.div>)}
            </div>
          </figure>
          <span className="ts-hub-arrow" aria-hidden="true"><ArrowRight size={22} /></span>
          <figure className="ts-hub-panel ts-hub-deep">
            <figcaption><span className="ts-hub-tag good">{t("Avec The One Space")}</span><b>{t("1 espace · vos règles")}</b></figcaption>
            <div className="ts-hub-box">
              <svg className="ts-rays" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{hub.map((n, i) => <motion.line key={n.name} x1="50" y1="50" x2={n.x} y2={n.y} vectorEffect="non-scaling-stroke" initial={false} animate={{ pathLength: on ? 1 : 0 }} transition={at(1.5 + i * 0.15, 0.4)} />)}</svg>
              <motion.div className="ts-hub-core" initial={false} animate={on ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.6 }} transition={still ? { duration: 0 } : { delay: 1.2, type: "spring", stiffness: 300, damping: 16 }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- SVG mark */}
                <img src="/favicon.svg" alt="" /><span>The One Space</span>
              </motion.div>
              {hub.map((n, i) => <motion.div key={n.name} className="ts-node" style={{ left: `${n.x}%`, top: `${n.y}%`, x: "-50%", y: "-50%" }} initial={false} animate={on ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.85 }} transition={at(1.7 + i * 0.15, 0.45)}><b><Check size={13} aria-hidden="true" />{n.name}</b><span>{t("au lieu de {tool}", { tool: n.from })}</span></motion.div>)}
            </div>
          </figure>
        </div>}
      </div>
    </section>
  );
}

// Where each tool lies on the wide stage, in % of its box, with its tilt in degrees; and where the module
// that replaces it sits once the space runs: around the mark, on the side the tool came from, and never
// right under it (its name is there).
const spots = [[19, 24, -6], [50, 17, 4], [81, 29, -3], [22, 71, 3], [53, 82, -4], [82, 70, 5]];
const ring = [[27, 18], [73, 18], [86, 50], [14, 50], [27, 82], [73, 82]];
// Which icon and colours each tool of the drawing gets on the stage (fx/gather.tsx).
const toolOf: Record<string, GatherTool> = { wa: "whatsapp", mail: "mail", drive: "drive", sheet: "excel", doc: "invoice", design: "design" };

/** The same story on wide screens, as the visitor scrolls a pinned stage (gather-stage.tsx): the six tools
 *  scattered, pulled into the middle, melted into the mark; then the space runs every module around it. */
function Gathered({ today, hub }: { today: { cls: string; name: string; pain: string }[]; hub: { name: string; from: string }[] }) {
  const { t } = useI18n();
  const key = today.map((tool) => tool.name + tool.pain).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt only when the words change (the language)
  const words = useMemo(() => today.map((tool, i) => ({ tool: toolOf[tool.cls], text: tool.name, note: tool.pain, x: spots[i][0], y: spots[i][1], rot: spots[i][2] })), [key]);
  const modules = hub.map((n, i) => ({ name: n.name, note: t("au lieu de {tool}", { tool: n.from }), x: ring[i][0], y: ring[i][1] }));
  return <GatherStage words={words} modules={modules} before={[t("Aujourd’hui"), t("6 outils · 0 règle")]} after={[t("Avec The One Space"), t("1 espace · vos règles")]} tagline={t("Un seul espace fait tourner toute l’agence")} />;
}

/** The agency's own method: the visitor plays three of the five sign-up questions and watches the path
 *  build (builder.tsx, fetched as the section comes near), then sees the same path in the app. */
function Method() {
  const { t } = useI18n();
  const slot = useRef<HTMLDivElement>(null);
  const near = useInView(slot, { once: true, margin: "800px 0px" });
  return (
    <section className="v6-sec" id="methode" aria-labelledby="v6-method">
      <div className="ts-wrap">
        <Head id="v6-method" title={t("Votre agence a sa méthode. Le logiciel la prend.")} lead={t("Vos étapes, vos relectures, votre façon de parler aux clients. The One Space s’adapte à votre agence, pas l’inverse.")} />
        <p className="v6-build-try">{t("Essayez : vos réponses construisent le chemin, comme à l’inscription.")}</p>
        <div className="v6-build-slot" ref={slot}>{near && <Builder />}</div>
        <figure className="v6-build-proof">
          <figcaption>{t("Le même chemin, dans l’app")}</figcaption>
          <Screen src="/landing/v6/08-chemin.webp" alt={t("Le même chemin, dans l’app")} />
        </figure>
      </div>
    </section>
  );
}

/** One rule; it lights up (gold edge, its number) when it reaches the middle of the screen, and stays lit. */
function Rule({ n, title, text }: { n: number; title: string; text: string }) {
  const still = useStill();
  const ref = useRef<HTMLLIElement>(null);
  const seen = useInView(ref, { once: true, margin: "-38% 0px -38% 0px" });
  return (
    <li ref={ref} className={still || seen ? "lit" : ""}>
      <span className="v6-rule-n" aria-hidden="true">{n}</span>
      <h3>{title}</h3>
      <p>{text}</p>
    </li>
  );
}

/** The rules the software keeps for the agency, next to a task waiting on the client. */
function Rules() {
  const { t } = useI18n();
  const rules = [
    [t("Le silence a une fin."), t("Choisissez ce que fait le silence du client : valider avec un reçu daté, relancer, ou prévenir un responsable. Après 24, 48 ou 72 h, par client ou par contrat.")],
    [t("Les retouches se comptent."), t("Les retours arrivent groupés par tour. Au-delà des tours prévus, le tour est marqué facturable.")],
    [t("Le calendrier se fige."), t("Quelques jours avant la publication, plus de changement de dernière minute, sauf accord d’un responsable.")],
  ];
  return (
    <section className="v6-sec v6-rules-sec" id="regles" aria-labelledby="v6-rules">
      <div className="ts-wrap v6-split">
        <div>
          <Head id="v6-rules" title={t("Vos règles, tenues pour vous.")} lead={t("Vous les fixez une fois. Le logiciel les applique à chaque livrable, sans que personne n’ait à relancer.")} />
          <ol className="v6-rules">{rules.map(([h, p], i) => <Rule key={h} n={i + 1} title={h} text={p} />)}</ol>
        </div>
        <div className="v6-rules-shot">
          <Screen src="/landing/v6/04-tache-chez-le-client.webp" alt={t("Une tâche chez le client : l’anneau des 48 h et le chemin du livrable")} />
          <p className="v6-clock-chip" aria-hidden="true"><span>{t("Validation tacite dans")}</span><LiveClock className="v6-clock" /></p>
        </div>
      </div>
    </section>
  );
}

/** The client's side: a branded portal on the phone, nothing to install, a decision with the thumb — which
 *  the visitor tries on a pile of demo cards (deck.tsx). */
function ClientSide() {
  const { t } = useI18n();
  const points = [
    [t("Rien à installer"), t("Un lien, prévenu sur WhatsApp ou par e-mail.")],
    [t("À votre marque, avec vos mots"), t("Votre logo, votre couleur, votre message d’accueil.")],
    [t("Une décision d’un geste"), t("Glisser à droite pour valider, à gauche pour demander une retouche.")],
    [t("Dans sa langue"), t("Français, anglais ou arabe, de droite à gauche.")],
  ];
  return (
    <section className="v6-sec v6-client-sec" id="client" aria-labelledby="v6-client">
      <div className="ts-wrap v6-split reverse">
        <div className="v6-try">
          <PhoneShot src="/landing/v6/05-portail-accueil-phone.webp" alt={t("Le portail du client : ce qui attend sa validation")} className="v6-try-phone" />
          <ClientDeck />
        </div>
        <div>
          <Head id="v6-client" title={t("Vos clients décident depuis leur téléphone.")} lead={t("Chaque client a son portail. Il voit ce qui l’attend, valide ou demande une retouche, et retrouve tout son historique.")} />
          <ul className="v6-points">{points.map(([h, p]) => <li key={h}><Check size={16} aria-hidden="true" /><div><b>{h}</b><span>{p}</span></div></li>)}</ul>
        </div>
      </div>
    </section>
  );
}

/** The page's one dark band: what the product holds to (facts, never invented customer figures), counted
 *  up once as they come into view, then the agency's dashboard. */
function Numbers() {
  const { t } = useI18n();
  const facts: [number, string][] = [
    [5, t("questions pour construire votre espace")],
    [4, t("réseaux où publier, à l’heure prévue")],
    [3, t("langues, de droite à gauche aussi")],
    [0, t("application à installer pour vos clients")],
  ];
  return (
    <section className="v6-sec v6-dark-sec" aria-labelledby="v6-numbers">
      <DeepPanel className="v6-band">
        <div className="ts-wrap v6-band-in">
          <Head id="v6-numbers" title={t("Vos chiffres, avec vos objectifs.")} lead={t("Contenus livrés à l’heure, délai de validation, tours de retouche : choisissez ce qui compte, fixez l’objectif, et voyez où en est l’agence, semaine après semaine.")} />
          <ul className="v6-facts">{facts.map(([n, label]) => <li key={label}><b>{n ? <CountUp to={n} duration={1.2} /> : n}</b><span>{label}</span></li>)}</ul>
          <Screen src="/landing/v6/10-vos-chiffres.webp" alt={t("Le tableau de bord de l’agence")} />
        </div>
      </DeepPanel>
    </section>
  );
}

function Everyday() {
  const { t } = useI18n();
  const items: [ReactNode, string, string][] = [
    [<Send key="s" size={18} />, t("Publication"), t("Instagram, Facebook, TikTok et YouTube, maintenant ou à l’heure prévue.")],
    [<Bot key="b" size={18} />, t("Un assistant qui connaît vos règles"), t("Il crée, commente et répond en français, anglais, arabe ou darija.")],
    [<ShieldCheck key="r" size={18} />, t("Relectures internes"), t("Des chaînes de relecture réservées aux bons rôles, avant que le client ne voie quoi que ce soit.")],
    [<LayoutGrid key="l" size={18} />, t("Tableau, calendrier, fichiers"), t("Toute l’équipe sur le même tableau, chaque tâche avec ses fichiers et son historique.")],
    [<Database key="d" size={18} />, t("Vos données vous appartiennent"), t("Exportez tout, à tout moment. Chaque agence a son espace isolé.")],
    [<Languages key="g" size={18} />, t("Trois langues"), t("Français, anglais et arabe, de droite à gauche, pour l’équipe comme pour les clients.")],
  ];
  return (
    <section className="v6-sec" aria-labelledby="v6-everyday">
      <div className="ts-wrap">
        <Head id="v6-everyday" title={t("Et tout le reste du quotidien.")} />
        <Screen src="/landing/v6/02-tableau.webp" alt={t("Le tableau des tâches de l’agence")} className="v6-board" />
        <div className="v6-bento" role="list">
          {items.map(([icon, h, p], i) => (
            <div key={h} role="listitem" className={`v6-bento-cell c${i}`}>
              <DepthCard className="glass v6-tile">
                <span className="v6-ico" aria-hidden="true">{icon}</span>
                <b>{h}</b>
                <p>{p}</p>
                {i === 0 && <span className="v6-tile-nets" aria-hidden="true">{(["instagram", "facebook", "tiktok", "youtube"] as const).map((n) => <NetworkIcon key={n} network={n} size={26} />)}</span>}
                {i === 5 && <span className="v6-tile-langs" aria-hidden="true"><i>FR</i><i>EN</i><i lang="ar">عربي</i></span>}
              </DepthCard>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** The pilot call. The stamp strikes once when the panel comes into view (a placeholder holds its place
 *  until then, so the panel doesn't move). */
function Pilot({ cta }: { cta: Cta }) {
  const { t } = useI18n();
  const mark = useRef<HTMLSpanElement>(null);
  const seen = useInView(mark, { once: true, amount: 0.6 });
  return (
    <section className="v6-sec v6-pilot-sec" aria-labelledby="v6-pilot">
      <div className="ts-wrap">
        <DeepPanel className="v6-pilot">
          <div className="v6-pilot-in">
            <div>
              <h2 id="v6-pilot">{t("Devenez agence pilote.")}</h2>
              <p>{t("Nous ouvrons The One Space à quelques agences marketing. Les tarifs seront fixés après le pilote.")}</p>
              <div className="v6-ctas start">
                <a className="v6-btn gold" href={cta.href} {...outward(cta)}>{cta.label}</a>
                <a className="v6-btn ghost" href={company.whatsapp} target="_blank" rel="noopener noreferrer">{t("Écrivez-nous sur WhatsApp")}</a>
              </div>
            </div>
            <span ref={mark} className="v6-pilot-stamp">{seen && <Stamp play size={150} />}</span>
          </div>
        </DeepPanel>
      </div>
    </section>
  );
}

function Questions() {
  const { t } = useI18n();
  const faqs = [
    [t("Mes clients doivent-ils installer quelque chose ?"), t("Non. Vous les invitez gratuitement ; ils valident depuis le navigateur de leur téléphone ou de leur ordinateur.")],
    [t("Le logiciel s’adapte-t-il à notre façon de travailler ?"), t("Oui. À l’inscription, cinq questions construisent votre espace : vos étapes, vos types de travail, vos relectures. Tout reste modifiable ensuite.")],
    [t("Que se passe-t-il si le client ne répond pas ?"), t("Vous choisissez : valider avec un reçu daté, relancer, ou prévenir un responsable, après 24, 48 ou 72 h, par client ou par contrat.")],
    [t("Sur quels réseaux puis-je publier ?"), t("Instagram, Facebook, TikTok et YouTube, maintenant ou à l’heure prévue.")],
    [t("Combien ça coûte ?"), t("Les tarifs seront fixés après le pilote. Les agences pilotes utilisent l’espace d’abord.")],
    [t("Mes données sont-elles protégées ?"), t("Chaque agence a son espace isolé, vous pouvez exporter toutes vos données à tout moment et demander leur suppression.")],
  ];
  return (
    <section className="v6-sec" id="questions" aria-labelledby="v6-faq">
      <div className="ts-wrap ts-faq-in">
        <div>
          <Head id="v6-faq" title={t("Les questions qu’on nous pose.")} />
          <p className="ts-faq-more">{t("Une autre question ?")} <a href={company.whatsapp} target="_blank" rel="noopener noreferrer">{t("Écrivez-nous sur WhatsApp")}</a></p>
        </div>
        <div className="ts-faq-list">{faqs.map(([q, a], i) => <details key={q} open={i === 0}><summary>{q}</summary><p>{a}</p></details>)}</div>
      </div>
    </section>
  );
}

function Footer() {
  const { t } = useI18n();
  return (
    <footer className="ts-footer">
      <div className="ts-wrap ts-footer-in">
        <div className="ts-f-brand">
          <span className="ts-f-logo">
            {/* eslint-disable-next-line @next/next/no-img-element -- SVG mark */}
            <img src="/favicon.svg" alt="" width={26} height={26} />The One Space
          </span>
          <p>{t("Le logiciel des agences marketing et de leurs clients, par The One Core.")}</p>
          <div className="ts-f-social">
            <a href={company.website} target="_blank" rel="noopener noreferrer" aria-label={t("Site web")}><Globe size={15} /></a>
            <a href={`mailto:${company.email}`} aria-label={t("E-mail")}><Mail size={15} /></a>
            <a href={company.whatsapp} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp"><MessageCircle size={15} /></a>
            <a href={company.phoneHref} aria-label={t("Téléphone")}><Phone size={15} /></a>
          </div>
          <LanguageSwitch compact />
        </div>
        <div><b>{t("Produit")}</b><a href="#methode">{t("Votre méthode")}</a><a href="#regles">{t("Vos règles")}</a><a href="#client">{t("Côté client")}</a><a href="#questions">{t("Questions")}</a></div>
        <div><b>{t("Aide et légal")}</b><a href={`mailto:${company.email}`}>{t("Nous contacter")}</a><a href="/conditions">{t("Conditions d’utilisation")}</a><a href="/confidentialite">{t("Politique de confidentialité")}</a><a href="/suppression-des-donnees">{t("Suppression des données")}</a><a href="/login">{t("Connexion")}</a></div>
        <dl className="ts-f-legal">
          <div><dt>{t("Éditeur")}</dt><dd>{company.name}</dd></div>
          <div><dt>{t("Activité")}</dt><dd>{t(company.activity)}</dd></div>
          <div><dt>{t("Siège")}</dt><dd>{t(company.city)}</dd></div>
          <div><dt>ICE</dt><dd dir="ltr">{company.ice}</dd></div>
          <div><dt>RC</dt><dd dir="ltr">{company.rc}</dd></div>
          <div><dt>{t("Téléphone")}</dt><dd><a href={company.phoneHref} dir="ltr">{company.phone}</a></dd></div>
        </dl>
      </div>
      <div className="ts-wordmark v6-shine" aria-hidden="true">The One Space</div>
      <div className="ts-wrap ts-f-bottom"><span>© {new Date().getFullYear()} The One Space · {t("par")} {company.name}. {t("Tous droits réservés.")}</span><span dir="ltr">ICE {company.ice} · RC {company.rc}</span></div>
    </footer>
  );
}

export default function LandingV6({ cta }: { cta: Cta }) {
  return (
    <>
      <TopBar cta={cta} />
      <main>
        <Hero cta={cta} />
        <WorksWith />
        <Tangle />
        <Method />
        <Rules />
        <ClientSide />
        <Numbers />
        <Everyday />
        <Pilot cta={cta} />
        <Questions />
      </main>
      <Footer />
    </>
  );
}
