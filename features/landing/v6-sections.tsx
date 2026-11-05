"use client";
// The landing below its first screen (v6.tsx draws the header and the hero): the networks, the six tools it
// replaces, the method, the rules, the client's side, the numbers, the everyday, the prices, the pilot
// agencies' word, the pilot call, the questions and the footer. Its own chunk, with motion: the server
// still draws it in the page, and it comes to life when the chunk arrives.
import dynamic from "next/dynamic";
import { LazyMotion, m, useInView } from "motion/react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Bot, Check, Database, Globe, Languages, LayoutGrid, Mail, MessageCircle, Phone, Send, ShieldCheck } from "lucide-react";
import NetworkIcon from "@/components/network-icon";
import LanguageSwitch from "@/components/language-switch";
import { useI18n } from "@/lib/i18n/locale-provider";
import { company } from "./company";
import { CountUp, DeepPanel, DepthCard, LiveClock, useRich, useStill } from "./ui";
import LogoLoop from "./fx/logo-loop";
import ClientDeck from "./deck";
import { Head, PhoneShot, Screen, Stamp, away, outward, type Cta } from "./v6-parts";
import type { GatherTool } from "./fx/gather";
import type { LandingContent } from "./content";

const GatherStage = dynamic(() => import("./gather-stage"), { ssr: false });
const Builder = dynamic(() => import("./builder"), { ssr: false });
// The sections draw with motion's light core (m); its features (animations, gestures, the deck's drag)
// arrive in their own chunk once the page is up (motion-features.ts).
const features = () => import("./motion-features").then((f) => f.default);

/** How to reach The One Core: what the owner set on Plateforme → Site, else the company's own details. */
function reach(contact: LandingContent["contact"]) {
  const digits = contact.whatsapp.replace(/\D/g, "").replace(/^0/, "212");
  return { email: contact.email || company.email, whatsapp: digits ? `https://wa.me/${digits}` : company.whatsapp };
}

/** The pilot price: the Agence plan, 30 % off. */
const pilotPrice = (agency: number) => Math.round(agency * 0.7);

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
              <svg className="ts-threads" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{threads.map((d, i) => <m.path key={d} d={d} vectorEffect="non-scaling-stroke" initial={false} animate={{ pathLength: on ? 1 : 0, opacity: on ? 1 : 0 }} transition={at(0.5 + i * 0.12, 0.9)} />)}</svg>
              {today.map((tool, i) => <m.div key={tool.cls} className={`ts-mess ${tool.cls}`} style={{ left: `${tool.x}%`, top: `${tool.y}%`, x: "-50%", y: "-50%" }} initial={false} animate={on ? { opacity: 1, scale: 1, rotate: tool.rot } : { opacity: 0, scale: 0.8, rotate: tool.rot * 5 }} transition={still ? { duration: 0 } : { delay: i * 0.08, type: "spring", stiffness: 260, damping: 18 }}><b><i aria-hidden="true" />{tool.name}</b><span>{tool.pain}</span></m.div>)}
            </div>
          </figure>
          <span className="ts-hub-arrow" aria-hidden="true"><ArrowRight size={22} /></span>
          <figure className="ts-hub-panel ts-hub-deep">
            <figcaption><span className="ts-hub-tag good">{t("Avec The One Space")}</span><b>{t("1 espace · vos règles")}</b></figcaption>
            <div className="ts-hub-box">
              <svg className="ts-rays" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{hub.map((n, i) => <m.line key={n.name} x1="50" y1="50" x2={n.x} y2={n.y} vectorEffect="non-scaling-stroke" initial={false} animate={{ pathLength: on ? 1 : 0 }} transition={at(1.5 + i * 0.15, 0.4)} />)}</svg>
              <m.div className="ts-hub-core" initial={false} animate={on ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.6 }} transition={still ? { duration: 0 } : { delay: 1.2, type: "spring", stiffness: 300, damping: 16 }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- SVG mark */}
                <img src="/favicon.svg" alt="" /><span>The One Space</span>
              </m.div>
              {hub.map((n, i) => <m.div key={n.name} className="ts-node" style={{ left: `${n.x}%`, top: `${n.y}%`, x: "-50%", y: "-50%" }} initial={false} animate={on ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.85 }} transition={at(1.7 + i * 0.15, 0.45)}><b><Check size={13} aria-hidden="true" />{n.name}</b><span>{t("au lieu de {tool}", { tool: n.from })}</span></m.div>)}
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

// The plans (decided 2026-10-31): people on the team and clients; the price a month is the owner's
// (Plateforme → Site), the year costs ten months. Pilot agencies get the Agence plan: two months free, then
// 30 % off for twelve months.
const limits = [
  { name: "Starter", key: "starter", people: 3, clients: 10 },
  { name: "Pro", key: "pro", people: 10, clients: 50 },
  { name: "Agence", key: "agency", people: 25, clients: 200 },
] as const;
/** A price in dirhams: Latin digits in every language, grouped the way the language groups them. */
const mad = (n: number, locale: string) => `${new Intl.NumberFormat(locale === "en" ? "en-US" : "fr-FR").format(n)} MAD`;

/** The prices: three plans, by the month or by the year, paid by bank transfer with an invoice. The
 *  Agence plan carries the pilot offer while it runs. */
function Pricing({ cta, prices, pilot }: { cta: Cta; prices: NonNullable<LandingContent["prices"]>; pilot: boolean }) {
  const { t, locale } = useI18n();
  const [yearly, setYearly] = useState(false);
  const money = (n: number) => mad(n, locale);
  const plans = limits.map((plan) => ({ ...plan, price: prices[plan.key] }));
  return (
    <section className="v6-sec" id="tarifs" aria-labelledby="v6-prices">
      <div className="ts-wrap">
        <Head id="v6-prices" title={t("Un prix clair, selon la taille de l’agence.")} lead={t("Payez par virement, avec facture : pas de carte bancaire.")} />
        <div className="v6-period" role="radiogroup" aria-label={t("Tarifs")}>
          <button type="button" role="radio" aria-checked={!yearly} onClick={() => setYearly(false)}>{t("Mensuel")}</button>
          <button type="button" role="radio" aria-checked={yearly} onClick={() => setYearly(true)}>{t("Annuel")} <em>{t("2 mois offerts")}</em></button>
        </div>
        <ul className="v6-plans">
          {plans.map((plan) => {
            const offer = pilot && plan.key === "agency", name = t(plan.name);
            return (
              <li key={plan.name} className={offer ? "pilot" : ""}>
                {offer && <span className="v6-plan-tag">{t("Le plan des agences pilotes")}</span>}
                <h3>{name}</h3>
                <p className="v6-plan-price"><b>{money(yearly ? plan.price * 10 : plan.price)}</b><span>{yearly ? t("/ an") : t("/ mois")}</span></p>
                <p className="v6-plan-sub">{yearly ? t("soit {price} / mois", { price: money(Math.round((plan.price * 10) / 12)) }) : "\u00a0"}</p>
                <ul>
                  <li><Check size={15} aria-hidden="true" />{t("Équipe : {n} personnes", { n: plan.people })}</li>
                  <li><Check size={15} aria-hidden="true" />{t("Clients : {n}", { n: plan.clients })}</li>
                </ul>
                {offer && <p className="v6-plan-pilot">{t("Agences pilotes : 2 mois offerts, puis {price} / mois pendant 12 mois.", { price: money(pilotPrice(prices.agency)) })} <a href="#pilote">{t("Voir l’offre")}</a></p>}
                <a className={`v6-btn ${offer ? "gold" : "line"}`} href={cta.href} {...outward(cta)}>{cta.label}</a>
              </li>
            );
          })}
        </ul>
        <p className="v6-plans-note">{prices.note ?? t("Prix par agence et par mois, hors taxes. Payé à l’année : 12 mois pour le prix de 10.")}</p>
      </div>
    </section>
  );
}

/** The pilot agencies' word: none is printed until an agency signs it, so the place says so plainly. */
function Voices({ cta }: { cta: Cta }) {
  const { t } = useI18n();
  return (
    <section className="v6-sec" aria-labelledby="v6-voices">
      <div className="ts-wrap">
        <Head id="v6-voices" title={t("Les retours des agences pilotes.")} />
        <div className="v6-voices">
          <span className="v6-voices-mark" aria-hidden="true">“</span>
          <p>{t("Les premières agences pilotes démarrent. Leurs retours, signés de leur nom, s’afficheront ici.")}</p>
          <a className="v6-voices-go" href={cta.href} {...outward(cta)}>{t("Votre agence peut être la première.")} <ArrowRight size={16} aria-hidden="true" /></a>
        </div>
      </div>
    </section>
  );
}

/** The pilot call. The stamp strikes once when the panel comes into view (a placeholder holds its place
 *  until then, so the panel doesn't move). */
function Pilot({ cta, pilot, prices, whatsapp }: { cta: Cta; pilot: NonNullable<LandingContent["pilot"]>; prices: LandingContent["prices"]; whatsapp: string }) {
  const { t, locale } = useI18n();
  const mark = useRef<HTMLSpanElement>(null);
  const seen = useInView(mark, { once: true, amount: 0.6 });
  // The owner's words when they wrote their own, else the page's (with the price only while prices show).
  const text = pilot.text ?? (prices
    ? t("Le plan Agence offert pendant 2 mois, puis 30 % de moins pendant 12 mois : {price} par mois. En échange, votre retour chaque semaine, et un témoignage si vous êtes satisfaits.", { price: mad(pilotPrice(prices.agency), locale) })
    : t("Le plan Agence offert pendant 2 mois, puis 30 % de moins pendant 12 mois. En échange, votre retour chaque semaine, et un témoignage si vous êtes satisfaits."));
  const date = pilot.deadline && new Intl.DateTimeFormat(locale === "ar" ? "ar-MA-u-nu-latn" : locale === "en" ? "en-GB" : "fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${pilot.deadline}T12:00:00Z`));
  const n = pilot.seatsLeft;
  const seats = n > 0 && date ? (n === 1 ? t("Encore 1 place, jusqu’au {date}.", { date }) : t("Encore {n} places, jusqu’au {date}.", { n, date }))
    : n > 0 ? (n === 1 ? t("Encore 1 place.") : t("Encore {n} places.", { n }))
    : date ? t("Jusqu’au {date}.", { date }) : "";
  return (
    <section className="v6-sec v6-pilot-sec" id="pilote" aria-labelledby="v6-pilot">
      <div className="ts-wrap">
        <DeepPanel className="v6-pilot">
          <div className="v6-pilot-in">
            <div>
              <h2 id="v6-pilot">{pilot.title ?? t("Devenez agence pilote.")}</h2>
              <p>{text}</p>
              {seats && <p className="v6-pilot-seats">{seats}</p>}
              <div className="v6-ctas start">
                <a className="v6-btn gold" href={cta.href} {...outward(cta)}>{cta.label}</a>
                <a className="v6-btn ghost" href={whatsapp} target="_blank" rel="noopener noreferrer">{t("Écrivez-nous sur WhatsApp")}</a>
              </div>
            </div>
            <span ref={mark} className="v6-pilot-stamp">{seen && <Stamp play size={150} />}</span>
          </div>
        </DeepPanel>
      </div>
    </section>
  );
}

function Questions({ prices, pilot, whatsapp }: { prices: LandingContent["prices"]; pilot: boolean; whatsapp: string }) {
  const { t, locale } = useI18n();
  // The price, only while the owner shows the prices; the pilot offer, only while it runs.
  const cost = prices && [t("De {from} à {to} par mois selon la taille de l’équipe et le nombre de clients.", { from: mad(prices.starter, locale), to: mad(prices.agency, locale) }), pilot ? t("Les agences pilotes ont le plan Agence offert 2 mois, puis 30 % de moins pendant 12 mois.") : ""].filter(Boolean).join(" ");
  const faqs = [
    [t("Mes clients doivent-ils installer quelque chose ?"), t("Non. Vous les invitez gratuitement ; ils valident depuis le navigateur de leur téléphone ou de leur ordinateur.")],
    [t("Le logiciel s’adapte-t-il à notre façon de travailler ?"), t("Oui. À l’inscription, cinq questions construisent votre espace : vos étapes, vos types de travail, vos relectures. Tout reste modifiable ensuite.")],
    [t("Que se passe-t-il si le client ne répond pas ?"), t("Vous choisissez : valider avec un reçu daté, relancer, ou prévenir un responsable, après 24, 48 ou 72 h, par client ou par contrat.")],
    [t("Sur quels réseaux puis-je publier ?"), t("Instagram, Facebook, TikTok et YouTube, maintenant ou à l’heure prévue.")],
    ...(cost ? [[t("Combien ça coûte ?"), cost]] : []),
    [t("Comment payer ?"), t("Par virement bancaire, avec une facture à chaque paiement. Au mois ou à l’année (12 mois pour le prix de 10). Pas de carte bancaire.")],
    [t("Mes données sont-elles protégées ?"), t("Chaque agence a son espace isolé, vous pouvez exporter toutes vos données à tout moment et demander leur suppression.")],
  ];
  return (
    <section className="v6-sec" id="questions" aria-labelledby="v6-faq">
      <div className="ts-wrap ts-faq-in">
        <div>
          <Head id="v6-faq" title={t("Les questions qu’on nous pose.")} />
          <p className="ts-faq-more">{t("Une autre question ?")} <a href={whatsapp} target="_blank" rel="noopener noreferrer">{t("Écrivez-nous sur WhatsApp")}</a></p>
        </div>
        <div className="ts-faq-list">{faqs.map(([q, a], i) => <details key={q} open={i === 0}><summary>{q}</summary><p>{a}</p></details>)}</div>
      </div>
    </section>
  );
}

/** LinkedIn's mark (lucide has no brand icons). */
const LinkedIn = () => (
  <svg width={15} height={15} viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M5 3.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM3.3 9h3.4v11.5H3.3zM9 9h3.3v1.6c.5-.9 1.7-1.9 3.5-1.9 3.6 0 4.3 2.4 4.3 5.5v6.3h-3.4v-5.6c0-1.3 0-3-1.9-3s-2.2 1.4-2.2 2.9v5.7H9z" /></svg>
);

export function Footer({ contact, social, prices }: { contact: LandingContent["contact"]; social: LandingContent["social"]; prices: boolean }) {
  const { t } = useI18n();
  const { email, whatsapp } = reach(contact);
  const where = [contact.city, contact.hours].filter(Boolean).join(" · ");
  return (
    <footer className="ts-footer">
      <div className="ts-wrap ts-footer-in">
        <div className="ts-f-brand">
          <span className="ts-f-logo">
            {/* eslint-disable-next-line @next/next/no-img-element -- SVG mark */}
            <img src="/favicon.svg" alt="" width={26} height={26} />The One Space
          </span>
          <p>{t("Le logiciel des agences marketing et de leurs clients, par The One Core.")}</p>
          {where && <p className="v6-f-where">{where}</p>}
          <div className="ts-f-social">
            <a href={company.website} target="_blank" rel="noopener noreferrer" aria-label={t("Site web")}><Globe size={15} /></a>
            <a href={`mailto:${email}`} aria-label={t("E-mail")}><Mail size={15} /></a>
            <a href={whatsapp} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp"><MessageCircle size={15} /></a>
            <a href={company.phoneHref} aria-label={t("Téléphone")}><Phone size={15} /></a>
            {social.instagram && <a href={social.instagram} {...away(social.instagram)} aria-label="Instagram"><NetworkIcon network="instagram" size={15} /></a>}
            {social.linkedin && <a href={social.linkedin} {...away(social.linkedin)} aria-label="LinkedIn"><LinkedIn /></a>}
          </div>
          <LanguageSwitch compact />
        </div>
        <div><b>{t("Produit")}</b><a href="#methode">{t("Votre méthode")}</a><a href="#regles">{t("Vos règles")}</a><a href="#client">{t("Côté client")}</a>{prices && <a href="#tarifs">{t("Tarifs")}</a>}<a href="#questions">{t("Questions")}</a></div>
        <div><b>{t("Aide et légal")}</b><a href={`mailto:${email}`}>{t("Nous contacter")}</a><a href="/conditions">{t("Conditions d’utilisation")}</a><a href="/confidentialite">{t("Politique de confidentialité")}</a><a href="/suppression-des-donnees">{t("Suppression des données")}</a><a href="/login">{t("Connexion")}</a></div>
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

export default function Sections({ cta, content }: { cta: Cta; content: LandingContent }) {
  const { pilot, prices, contact } = content;
  const { whatsapp } = reach(contact);
  return (
    <LazyMotion features={features}>
      <WorksWith />
      <Tangle />
      <Method />
      <Rules />
      <ClientSide />
      <Numbers />
      <Everyday />
      {prices && <Pricing cta={cta} prices={prices} pilot={!!pilot} />}
      <Voices cta={cta} />
      {pilot && <Pilot cta={cta} pilot={pilot} prices={prices} whatsapp={whatsapp} />}
      <Questions prices={prices} pilot={!!pilot} whatsapp={whatsapp} />
    </LazyMotion>
  );
}
