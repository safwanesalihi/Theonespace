"use client";
// The public page below the introduction (features/landing/space-hero.tsx). Each section is a "sheet"
// that slides over the previous one: the agency's week (six tangled tools, then one space where each
// becomes a module), the three rules you can try, the client's side, the six topics as a bento (each opens
// its window), an honest comparison on paper receipts, prices from lib/plans.ts, the questions, the
// closing call and the footer. Gold, black, grey and silver only: frosted silver glass, deep graphite and
// the deep silver panel; other colours only as small marks (tool icons, dots). Sample names.
import { useState } from "react";
import { ArrowRight, Check, Globe, Mail, MessageCircle, Phone } from "lucide-react";
import { useI18n } from "@/lib/i18n/locale-provider";
import LanguageSwitch from "@/components/language-switch";
import { paidPlanIds, plans, trialDays } from "@/lib/plans";
import { planets } from "./planets";
import { TopicArt, topicTone } from "./topic-art";
import { company } from "./company";
import { landingFonts } from "./fonts";
import { Orb, type Cta } from "./space-hero";
import { DeepPanel, DepthCard, LiveClock, Reveal } from "./ui";
import { PlanetLink } from "./windows";
import "./sections.css";

const outward = (cta: Cta) => (cta.external ? { target: "_blank", rel: "noopener noreferrer" } : {});

function Head({ label, title, accent, lead, id }: { label: string; title: string; accent: string; lead?: string; id: string }) {
  return (
    <Reveal className="ts-head-block">
      <p className="ts-label">{label}</p>
      <h2 id={id} className="ts-h2">{title} <em>{accent}</em></h2>
      {lead && <p className="ts-lead">{lead}</p>}
    </Reveal>
  );
}

/** 1 · The agency's week: six tools tangled together today, then one space where each becomes a module. */
function BeforeAfter() {
  const { t } = useI18n();
  // Positions are percentages of each panel; the today-side tiles sit at the ends of the tangled threads.
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
    { name: t("Calendrier gelé à J−7"), from: "Excel", x: 50, y: 89 },
    { name: t("Devis et factures"), from: t("Facture"), x: 17, y: 69 },
    { name: t("Tâches et retours"), from: t("Design"), x: 17, y: 31 },
  ];
  return (
    <section className="ts-before ts-sheet" aria-labelledby="ts-before-title">
      <div className="ts-wrap">
        <Head id="ts-before-title" label={t("Votre semaine")} title={t("Six outils qui ne se parlent pas.")} accent={t("Un espace où tout se répond.")} />
        <div className="ts-hubs">
          <Reveal><figure className="ts-hub-panel ts-glass">
            <figcaption><span className="ts-hub-tag bad">{t("Aujourd’hui")}</span><b>{t("6 outils · 0 règle")}</b></figcaption>
            <div className="ts-hub-box">
              <svg className="ts-threads" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                {threads.map((d) => <path key={d} d={d} vectorEffect="non-scaling-stroke" />)}
              </svg>
              {today.map((tool) => (
                <div key={tool.cls} className={`ts-mess ${tool.cls}`} style={{ left: `${tool.x}%`, top: `${tool.y}%`, rotate: `${tool.rot}deg` }}>
                  <b><i aria-hidden="true" />{tool.name}</b><span>{tool.pain}</span>
                </div>
              ))}
            </div>
          </figure></Reveal>
          <span className="ts-hub-arrow" aria-hidden="true"><ArrowRight size={22} /></span>
          <Reveal delay={0.12}><DeepPanel tone="silver" className="ts-hub-panel ts-hub-deep"><figure>
            <figcaption><span className="ts-hub-tag good">{t("Avec The One Space")}</span><b>{t("1 espace · 3 règles")}</b></figcaption>
            <div className="ts-hub-box">
              <svg className="ts-rays" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                {hub.map((node) => <line key={node.name} x1="50" y1="50" x2={node.x} y2={node.y} vectorEffect="non-scaling-stroke" />)}
              </svg>
              <div className="ts-hub-core">
                {/* eslint-disable-next-line @next/next/no-img-element -- SVG mark */}
                <img src="/favicon.svg" alt="" /><span>The One Space</span>
              </div>
              {hub.map((node) => (
                <div key={node.name} className="ts-node" style={{ left: `${node.x}%`, top: `${node.y}%` }}>
                  <b><Check size={13} aria-hidden="true" />{node.name}</b><span>{t("au lieu de {tool}", { tool: node.from })}</span>
                </div>
              ))}
            </div>
          </figure></DeepPanel></Reveal>
        </div>
      </div>
    </section>
  );
}

/** 2 · The three rules, each a small screen you can try. */
function Rules() {
  const { t } = useI18n();
  const [round, setRound] = useState(0);
  const roundLabel = round <= 2 ? t("Tour {n}/2 · inclus", { n: round }) : t("Tour {n} · hors forfait, facturé", { n: round });
  return (
    <section className="ts-rules ts-sheet" aria-labelledby="ts-rules-title">
      <div className="ts-wrap">
        <Head id="ts-rules-title" label={t("La méthode The One Flow")} title={t("Trois règles.")} accent={t("Le logiciel les fait respecter.")} />
        <div className="ts-rule-grid">
          <Reveal><DepthCard className="ts-rule" tilt>
            <span className="ts-rule-n">01</span><h3>{t("48 heures pour valider")}</h3>
            <p>{t("Le client reçoit le contenu sur WhatsApp. Rappels à 24 h et à 6 h. Sans réponse, c’est validé, avec un reçu daté.")}</p>
            <div className="ts-screen-card"><span className="ts-mini">{t("Café Atlas · Reel lancement")}</span><LiveClock /><span className="ts-mini">{t("avant validation tacite")}</span><div className="ts-bar"><i /></div></div>
          </DepthCard></Reveal>
          <Reveal delay={0.08}><DepthCard className="ts-rule" tilt>
            <span className="ts-rule-n">02</span><h3>{t("Deux tours de retouche inclus")}</h3>
            <p>{t("Les retours sont regroupés par tour. À partir du troisième, le logiciel le marque hors forfait, prêt à facturer.")}</p>
            <div className="ts-screen-card"><span className="ts-mini">{t("Story promo · v{n}", { n: round + 1 })}</span>
              <div className="ts-pips" aria-hidden="true">{[1, 2, 3].map((n) => <i key={n} className={n <= round ? (n > 2 ? "over" : "on") : ""} />)}</div>
              <span className={`ts-round${round > 2 ? " over" : ""}`}>{roundLabel}</span>
              <div className="ts-round-btns"><button type="button" onClick={() => setRound((r) => Math.min(r + 1, 4))}>{t("Demander une retouche")}</button><button type="button" className="ghost" onClick={() => setRound(0)}>{t("Recommencer")}</button></div></div>
          </DepthCard></Reveal>
          <Reveal delay={0.16}><DepthCard className="ts-rule" tilt>
            <span className="ts-rule-n">03</span><h3>{t("Calendrier gelé à J−7")}</h3>
            <p>{t("La semaine de la publication, plus de changement de dernière minute. Les étapes se calculent à rebours : J−14, J−7, J−5, J−1.")}</p>
            <div className="ts-screen-card"><div className="ts-gates">
              {([["J−14", t("Brief validé"), true], ["J−7", t("Envoi au client"), true], ["J−5", t("Validation client"), true], ["J−1", t("Prêt à publier"), false]] as const).map(([j, label, done]) => (
                <div key={j} className={`ts-gate${done ? " done" : ""}`}><b>{j}</b><span>{label}</span></div>
              ))}</div><span className="ts-freeze">🔒 {t("Gelé : changements sur accord de l’administrateur")}</span></div>
          </DepthCard></Reveal>
        </div>
      </div>
    </section>
  );
}

/** 3 · What the client sees: nothing to install, one link, one button. */
function ClientSide() {
  const { t } = useI18n();
  const points = [
    [t("Une alerte WhatsApp ou un e-mail"), t("« Votre reel est prêt à valider », avec le lien.")],
    [t("Valider ou demander une retouche"), t("Depuis le téléphone, sans rien installer.")],
    [t("Devis, factures et contrats"), t("Au même endroit, dans son portail.")],
    [t("À votre marque, dans sa langue"), t("Votre logo et votre couleur. Français, anglais ou arabe.")],
  ];
  return (
    <section className="ts-client ts-sheet" aria-labelledby="ts-client-title">
      <div className="ts-wrap ts-client-in">
        <div>
          <Head id="ts-client-title" label={t("Côté client")} title={t("Votre client ne télécharge rien.")} accent={t("Il valide.")} />
          <ul className="ts-points">{points.map(([h, p], i) => <Reveal key={h} delay={i * 0.07}><li><span className="ts-tick"><Check size={15} aria-hidden="true" /></span><div><b>{h}</b><span>{p}</span></div></li></Reveal>)}</ul>
        </div>
        <Reveal y={60}><div className="ts-client-stage" aria-hidden="true">
          <div className="ts-client-glow" />
          <div className="ts-client-phone"><div className="ts-cp-screen">
            <div className="ts-cp-notif"><span>✓</span><div><b>Studio Nour · WhatsApp</b><br />{t("Votre carrousel est prêt à valider.")}</div></div>
            <div className="ts-cp-brand"><i>SN</i>Studio Nour</div>
            <div className="ts-cp-post"><b>5 secrets</b><em>{t("du barista")}</em></div>
            <div className="ts-cp-row"><span>{t("Validation tacite dans")}</span><b>31 h 12</b></div>
            <div className="ts-cp-btns"><span>{t("Retouche · 1/2")}</span><span className="go">{t("Valider")}</span></div>
            <div className="ts-cp-tabs"><span className="on">{t("À valider")}</span><span>{t("Planning")}</span><span>{t("Factures")}</span></div>
          </div></div>
        </div></Reveal>
      </div>
    </section>
  );
}

/** 4 · The six topics as a bento; each opens its window. */
function Explore() {
  const { t } = useI18n();
  return (
    <section className="ts-explore ts-sheet" aria-labelledby="ts-explore-title">
      <div className="ts-wrap">
        <Head id="ts-explore-title" label={t("Explorer l’espace")} title={t("Tout ce qu’il faut pour livrer.")} accent={t("Rien de plus.")} />
        <div className="ts-bento">
          {planets.map(({ slug, icon: Icon, title, tagline }, i) => (
            <Reveal key={slug} delay={(i % 3) * 0.07} className={`ts-bento-cell ${slug}`}>
              <PlanetLink slug={slug} className="ts-planet-link">
                <DepthCard className={`ts-bento-card ${topicTone[slug]}`}>
                  <div className="ts-bento-top"><span className="ts-pc-icon"><Icon size={18} aria-hidden="true" /></span><b>{t(title)}</b></div>
                  <span className="ts-pc-text">{t(tagline)}</span>
                  <TopicArt slug={slug} />
                  <span className="ts-pc-open">{t("Ouvrir la fenêtre")} <ArrowRight size={15} className="os-arrow" aria-hidden="true" /></span>
                </DepthCard>
              </PlanetLink>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/** 5 · The same deliverable, three ways: an honest comparison on paper receipts. */
function Compare() {
  const { t } = useI18n();
  const rows = [t("Validé ?"), t("Retouches"), t("Sans réponse"), t("La preuve")];
  const cols = [
    { name: t("Groupe WhatsApp"), cells: [t("« ok 👍 » perdu dans 200 messages"), t("illimitées"), t("vous relancez"), t("aucune")], tone: "" },
    { name: t("Outil d’approbation classique"), cells: [t("un bouton"), t("autant de tours qu’il faut"), t("des rappels, puis on attend"), t("un historique")], tone: "" },
    { name: "The One Space", cells: [t("en un clic, depuis le téléphone"), t("2 incluses, la 3ᵉ facturée"), t("validé à 48 h"), t("un reçu signé et daté")], tone: "win" },
  ];
  return (
    <section className="ts-compare ts-sheet" aria-labelledby="ts-compare-title">
      <div className="ts-wrap">
        <Head id="ts-compare-title" label={t("Comparer")} title={t("Le même reel.")} accent={t("Trois façons de le faire valider.")} />
        <DeepPanel className="ts-receipts-panel"><div className="ts-receipts">
          {cols.map((col, i) => (
            <Reveal key={col.name} delay={i * 0.1} y={50}><div className={`ts-rc ${col.tone}`}>
              <div className="ts-rc-h">{col.name}</div><hr />
              {rows.map((row, r) => <div key={row} className="ts-rc-row"><span>{row}</span><b>{col.cells[r]}</b></div>)}
              {col.tone === "win" && (
                <div className="ts-rc-seal">
                  {/* eslint-disable-next-line @next/next/no-img-element -- SVG mark */}
                  <img src="/favicon.svg" alt="" />
                </div>
              )}
            </div></Reveal>
          ))}
        </div></DeepPanel>
      </div>
    </section>
  );
}

/** 6 · Prices, straight from lib/plans.ts. */
function Pricing({ cta }: { cta: Cta }) {
  const { t } = useI18n();
  const storage = (mb: number) => (mb >= 1024 ? `${Math.round(mb / 1024)} ${t("Go")}` : `${mb} ${t("Mo")}`);
  return (
    <section className="ts-pricing ts-sheet" id="tarifs" aria-labelledby="ts-pricing-title">
      <div className="ts-wrap">
        <Head id="ts-pricing-title" label={t("Tarifs")} title={t("{days} jours pour essayer.", { days: trialDays })} accent={t("Vos clients ne paient jamais.")} />
        <div className="ts-plans">
          {paidPlanIds.map((id, i) => {
            const plan = plans[id];
            const featured = id === "pro";
            return (
              <Reveal key={id} delay={i * 0.08}><DepthCard className={`ts-plan ${featured ? "featured deep" : "glass"}`}>
                {featured && <span className="ts-plan-tag">{t("Recommandé")}</span>}
                <h3>{t(plan.name)}</h3>
                <p className="ts-price"><b>{plan.priceMad.toLocaleString("fr-FR")}</b> {t("MAD / mois")}</p>
                <ul>
                  <li><Check size={15} aria-hidden="true" />{t("{n} membres de l’équipe", { n: plan.limits.members })}</li>
                  <li><Check size={15} aria-hidden="true" />{t("{n} clients", { n: plan.limits.clients })}</li>
                  <li><Check size={15} aria-hidden="true" />{t("{size} de fichiers", { size: storage(plan.limits.storageMb) })}</li>
                  <li><Check size={15} aria-hidden="true" />{t("{n} demandes à l’IA par mois", { n: plan.limits.aiPerMonth.toLocaleString("fr-FR") })}</li>
                  <li><Check size={15} aria-hidden="true" />{t("Toutes les fonctionnalités")}</li>
                </ul>
                <a className={`ts-btn ${featured ? "gold" : "ink"} block`} href={cta.href} {...outward(cta)}>{cta.label}</a>
              </DepthCard></Reveal>
            );
          })}
        </div>
        <p className="ts-fine">{t("Essai de {days} jours avec toutes les fonctionnalités, sans carte bancaire. Paiement par virement ou par carte. Besoin de plus ?", { days: trialDays })} <a href={`mailto:${company.email}`}>{t("Écrivez-nous")}</a>.</p>
      </div>
    </section>
  );
}

/** 7 · The questions buyers actually ask. */
function Questions() {
  const { t } = useI18n();
  const faqs = [
    [t("Mes clients doivent-ils installer quelque chose ?"), t("Non. Vous les invitez gratuitement ; ils valident depuis le navigateur de leur téléphone ou de leur ordinateur.")],
    [t("Puis-je changer les 48 h et les deux tours ?"), t("Oui. Ce sont les valeurs par défaut : vous les réglez pour tout l’espace ou pour chaque client, et elles peuvent figurer dans le contrat que le client accepte dans son portail.")],
    [t("Que se passe-t-il si le client ne répond pas ?"), t("Il reçoit un rappel à 24 h puis à 6 h. À l’échéance, le contenu est validé et un reçu daté est ajouté à son historique.")],
    [t("Sur quels réseaux puis-je publier ?"), t("Facebook et Instagram, maintenant ou à l’heure prévue. TikTok et YouTube arrivent bientôt.")],
    [t("Comment se passe le paiement ?"), t("Après l’essai, vous choisissez un plan dans l’application ; The One Core vous contacte pour le règlement, par virement ou par carte, et active le plan.")],
    [t("Mes données sont-elles protégées ?"), t("Chaque entreprise a son espace isolé, les mots de passe sont chiffrés et vous pouvez demander la suppression de vos données à tout moment.")],
  ];
  return (
    <section className="ts-faq ts-sheet" id="questions" aria-labelledby="ts-faq-title">
      <div className="ts-wrap ts-faq-in">
        <div>
          <Head id="ts-faq-title" label={t("Questions")} title={t("Ce qu’on nous demande")} accent={t("le plus souvent.")} />
          <Reveal><p className="ts-faq-more">{t("Une autre question ?")} <a href={company.whatsapp} target="_blank" rel="noopener noreferrer">{t("Écrivez-nous sur WhatsApp")}</a></p></Reveal>
        </div>
        <div className="ts-faq-list">{faqs.map(([q, a], i) => <Reveal key={q} delay={i * 0.05}><details open={i === 0}><summary>{q}</summary><p>{a}</p></details></Reveal>)}</div>
      </div>
    </section>
  );
}

/** 8 · The closing call and the footer, with the legal details and a large wordmark. */
function Closing({ cta }: { cta: Cta }) {
  const { t } = useI18n();
  return (
    <>
      <section className="ts-close ts-sheet" aria-labelledby="ts-close-title">
        <div className="ts-close-beam" aria-hidden="true" />
        <div className="ts-wrap"><DeepPanel className="ts-close-in">
          <Reveal><h2 id="ts-close-title" className="ts-h2 big">{t("Le silence de vos clients")} <em>{t("vaut enfin une réponse.")}</em></h2></Reveal>
          <Reveal delay={0.15}><div className="ts-close-orbs">
            <Orb planet="methode" label={t("Voir la méthode")} glyph="▶" tone="light" />
            <Orb href={cta.href} external={cta.external} label={cta.ring} glyph="→" tone="gold" />
          </div></Reveal>
        </DeepPanel></div>
      </section>
      <footer className="ts-footer">
        <div className="ts-wrap ts-footer-in">
          <div className="ts-f-brand">
            <span className="ts-f-logo">
              {/* eslint-disable-next-line @next/next/no-img-element -- SVG mark */}
              <img src="/favicon.svg" alt="" width={26} height={26} />The One Space
            </span>
            <p>{t("Le logiciel des agences social media et de leurs clients, par The One Core.")}</p>
            <div className="ts-f-social">
              <a href={company.website} target="_blank" rel="noopener noreferrer" aria-label={t("Site web")}><Globe size={15} /></a>
              <a href={`mailto:${company.email}`} aria-label={t("E-mail")}><Mail size={15} /></a>
              <a href={company.whatsapp} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp"><MessageCircle size={15} /></a>
              <a href={company.phoneHref} aria-label={t("Téléphone")}><Phone size={15} /></a>
            </div>
            <LanguageSwitch compact />
          </div>
          <div><b>{t("Produit")}</b>{planets.map((p) => <PlanetLink key={p.slug} slug={p.slug}>{t(p.title)}</PlanetLink>)}<a href="#tarifs">{t("Tarifs")}</a></div>
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
        <div className="ts-wordmark" aria-hidden="true">The One Space</div>
        <div className="ts-wrap ts-f-bottom"><span>© {new Date().getFullYear()} The One Space · {t("par")} {company.name}. {t("Tous droits réservés.")}</span><span dir="ltr">ICE {company.ice} · RC {company.rc}</span></div>
      </footer>
    </>
  );
}

export default function LandingSections({ cta }: { cta: Cta }) {
  return (
    <div className={landingFonts}>
      <BeforeAfter />
      <Rules />
      <ClientSide />
      <Explore />
      <Compare />
      <Pricing cta={cta} />
      <Questions />
      <Closing cta={cta} />
    </div>
  );
}
