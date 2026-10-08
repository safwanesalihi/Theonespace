"use client";
// The public home page (app/page.tsx shows it to anyone signed out). Laid out like a modern SaaS page —
// section order and card styles modelled on orshot.com, at the owner's request — with The One Space's
// own words, The One Core's black, gold and white, its logo, and its legal details in the footer. The
// product frames are real screenshots of the app with sample data; prices come from lib/plans.ts.
import { useState } from "react";
import {
  ArrowRight, ArrowUpRight, BadgeCheck, BarChart3, Bot, Building2, Check, ChevronDown, Clock3, Copy, FileText, FolderOpen, Globe, History, Inbox, KeyRound, Languages, Lock, Mail, Megaphone, Menu, MessageCircle, Palette, Phone, Send, ShieldCheck, Sparkles, Trash2, UserCog, Users, Video, X,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/locale-provider";
import LanguageSwitch from "@/app/language-switch";
import NetworkIcon from "@/app/network-icon";
import { paidPlanIds, plans, trialDays, type PaidPlanId } from "@/lib/plans";
import "./landing.css";

/** The One Core's legal and contact details, as printed on its invoices (lib/document-pdf-core.ts). */
export const company = {
  name: "The One Core",
  activity: "Agence de communication",
  ice: "003921894000076",
  rc: "27375",
  city: "Berrechid, Maroc",
  phone: "+212 6 07 48 48 22",
  phoneHref: "tel:+212607484822",
  whatsapp: "https://wa.me/212607484822",
  email: "contact@the1core.com",
  website: "https://the1core.com",
  websiteLabel: "the1core.com",
};

const shots = [
  { id: "dashboard", label: "Tableau de bord" },
  { id: "board", label: "Tâches" },
  { id: "clients", label: "Clients" },
  { id: "portal", label: "Portail client" },
];

const timeline = [
  ["Tâche", [["09:12", "Salma", "Tâche créée « Reel lancement » · Café Atlas · échéance vendredi"], ["09:14", "Salma", "Assignée à Yassine · Plan éditorial · Instagram, TikTok"], ["11:30", "Yassine", "Version 1 déposée · reel-lancement-v1.mp4"]]],
  ["Validation", [["11:31", "Studio", "Envoyé au client · validation tacite dans 48 h"], ["14:05", "Karim", "Retouche demandée · tour 1/2 · « Le logo un peu plus grand »"], ["16:20", "Karim", "Validé ✓"]]],
  ["Publication", [["16:21", "Studio", "Programmé · Instagram Reel + TikTok · vendredi 18:00"], ["18:00", "The One Space", "Publié sur Instagram · 1080 × 1920"], ["18:00", "The One Space", "Publié sur TikTok"]]],
  ["Facture", [["09:00", "Salma", "Devis DEVIS-2026-0014 accepté"], ["09:02", "Salma", "Facture FACTURE-2026-0031 envoyée · PDF à votre marque"], ["17:45", "Salma", "Paiement reçu · statut : payée"]]],
  ["Rapport", [["08:00", "The One Space", "Rapport mensuel prêt · Café Atlas"], ["08:00", "The One Space", "Abonnés, portée, engagement, meilleures publications"], ["08:01", "Salma", "Rapport partagé sur le portail du client"]]],
] as const;

const aiTiles = [
  { icon: Sparkles, label: "Légendes" }, { icon: Video, label: "Titres YouTube" },
  { icon: Check, label: "Correction" }, { icon: Bot, label: "Assistant" },
  { icon: BarChart3, label: "Audit Instagram" }, { icon: FileText, label: "Rapport mensuel" },
  { icon: Languages, label: "Dans leur langue" }, { icon: ArrowUpRight, label: "Toutes les fonctions" },
];

const brandCards = [
  { icon: Palette, title: "Votre logo, votre couleur", text: "Dans l’application, le portail, les e-mails et les PDF." },
  { icon: Users, title: "Un portail pour chaque client", text: "Il ne voit que ses contenus, ses réunions, ses demandes." },
  { icon: FileText, title: "Devis et factures à votre nom", text: "Numérotés automatiquement, prêts à envoyer en PDF." },
];

const smallCards = [
  { icon: Video, title: "Réunions intégrées", text: "Vidéo ou audio avec vos clients, sans lien externe." },
  { icon: Inbox, title: "Demandes clients", text: "Le client écrit depuis son portail, vous acceptez en tâche." },
  { icon: Clock3, title: "Temps et activité", text: "Le chronomètre tourne quand une tâche est en cours." },
  { icon: MessageCircle, title: "WhatsApp et e-mail", text: "Le client est prévenu là où il lit vraiment ses messages." },
  { icon: Languages, title: "Français, anglais, arabe", text: "Chacun choisit sa langue, vos clients aussi." },
  { icon: ArrowUpRight, title: "Toutes les fonctionnalités", text: "Kanban, calendrier, bibliothèque, tableau de bord et plus." },
];

const securityCards = [
  { icon: Lock, title: "Chaque entreprise isolée", text: "Vos clients, fichiers et factures ne croisent jamais un autre espace." },
  { icon: UserCog, title: "Rôles et accès", text: "Propriétaire, administrateur, membre, social media manager, observateur, client." },
  { icon: History, title: "Historique complet", text: "Chaque version, chaque retour, chaque validation est gardée." },
  { icon: KeyRound, title: "Mots de passe chiffrés", text: "Jamais lisibles, même par nous. Réinitialisation par e-mail." },
  { icon: FolderOpen, title: "Vos fichiers", text: "Livrables, PDF et messages vocaux rangés par client et par tâche." },
  { icon: ShieldCheck, title: "Connexions protégées", text: "Tentatives limitées, sessions sécurisées, en-têtes de sécurité." },
  { icon: Trash2, title: "Suppression sur demande", text: "Vos données vous appartiennent : supprimées quand vous le demandez." },
  { icon: Building2, title: "Toujours à jour", text: "Rien à installer : les nouveautés arrivent directement dans votre espace." },
];

const uses = [
  { tag: "Agences", tone: "gold", text: "Dix clients, trois créatifs, un social media manager : chacun voit ses tâches, chaque client ne voit que les siennes.", who: "Agence de communication" },
  { tag: "Validation", tone: "dark", text: "Le client valide depuis son téléphone. Vous définissez son délai de réponse ; sans réponse à l’échéance, le contenu est validé automatiquement.", who: "Studio créatif" },
  { tag: "Social media", tone: "gold", text: "La semaine est préparée le lundi, validée le mardi, et publiée toute seule sur Instagram, TikTok et YouTube.", who: "Social media manager" },
  { tag: "Freelances", tone: "dark", text: "Un espace professionnel à votre nom : vos clients découvrent vos livrables dans un portail à votre image.", who: "Freelance" },
  { tag: "Facturation", tone: "gold", text: "Le devis accepté devient une facture numérotée, envoyée en PDF, et son paiement est suivi au même endroit.", who: "Direction" },
  { tag: "Rapports", tone: "dark", text: "Chaque mois, le rapport de chaque client est prêt : abonnés, portée, engagement, meilleures publications.", who: "Chef de projet" },
];

const faqs = [
  ["Qu’est-ce que The One Space ?", "L’espace de travail des agences et de leurs clients : tâches, validations, plan éditorial, publication sur les réseaux, réunions, devis et factures."],
  ["Mes clients doivent-ils payer ?", "Non. Vous les invitez gratuitement ; ils accèdent à leur portail depuis leur navigateur, sans rien installer."],
  ["Comment fonctionne la validation tacite ?", "Vous choisissez le délai de validation et les tours de modifications inclus dans les paramètres ou pour chaque client. À l’envoi du livrable, le compte à rebours commence ; sans réponse à l’échéance, le contenu est validé automatiquement."],
  ["Sur quels réseaux puis-je publier ?", "Instagram, Facebook, TikTok et YouTube : publications, carrousels, reels, stories, shorts et albums, maintenant ou à l’heure prévue."],
  ["Comment se passe l’essai gratuit ?", "{days} jours avec toutes les fonctionnalités, sans carte bancaire. À la fin, choisissez un plan ; vos données restent consultables en attendant."],
  ["Comment payer mon abonnement ?", "Choisissez votre plan depuis l’espace : The One Core vous contacte pour le règlement (virement ou carte) et active le plan."],
  ["Puis-je utiliser mon logo et ma couleur ?", "Oui : votre logo et votre couleur remplacent les nôtres dans l’application, le portail client, les e-mails et les PDF."],
  ["Dans quelles langues ?", "Français, anglais et arabe, pour vous comme pour vos clients."],
  ["Mes données sont-elles protégées ?", "Chaque entreprise a son espace séparé, les mots de passe sont chiffrés, et vous pouvez demander la suppression de vos données à tout moment."],
  ["Puis-je inviter toute mon équipe ?", "Oui, selon votre plan : chaque membre a son rôle et ne voit que ce qui le concerne."],
];

const networks = ["instagram", "facebook", "tiktok", "youtube"] as const;
const networkName = (n: (typeof networks)[number]) => ({ instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", youtube: "YouTube" })[n];

export default function Landing({ signup }: { signup: boolean }) {
  const { t, dir } = useI18n();
  const [menu, setMenu] = useState(false);
  const [shot, setShot] = useState(0);
  const [tab, setTab] = useState(0);
  const [persona, setPersona] = useState(0);
  const [faq, setFaq] = useState<number | null>(0);
  // Phones show one plan at a time, picked with the switch above the card (desktop shows all three).
  const [shownPlan, setShownPlan] = useState<PaidPlanId>("pro");
  const start = signup ? "/login?mode=signup" : "/login";
  const startLabel = signup ? t("Commencer gratuitement") : t("Se connecter");
  const storage = (mb: number) => (mb >= 1024 ? `${Math.round(mb / 1024)} ${t("Go")}` : `${mb} ${t("Mo")}`);
  const prompts = [
    "Quels contenus de Café Atlas attendent encore une validation ?",
    "Propose trois idées de stories pour la semaine de Nour Beauty.",
    "Comment inviter un client sur son portail ?",
  ];

  return (
    <div className="os" dir={dir}>
      {/* Navigation */}
      <header className="os-nav">
        <div className="os-wrap os-nav-in">
          {/* eslint-disable-next-line @next/next/no-img-element -- SVG logo */}
          <a href="#" className="os-logo" aria-label="The One Core"><img src="/the-one-core-logo-dark.svg" alt="The One Core" /></a>
          <nav className={`os-menu${menu ? " open" : ""}`} aria-label={t("Navigation")}>
            <a href="#produit" onClick={() => setMenu(false)}>{t("Produit")}</a>
            <a href="#fonctionnalites" onClick={() => setMenu(false)}>{t("Fonctionnalités")}</a>
            <a href="#securite" onClick={() => setMenu(false)}>{t("Sécurité")}</a>
            <a href="#tarifs" onClick={() => setMenu(false)}>{t("Tarifs")}</a>
            <a href="#questions" onClick={() => setMenu(false)}>{t("Questions")}</a>
            <a href="#entreprise" onClick={() => setMenu(false)}>{t("Entreprise")}</a>
            <a className="os-menu-login" href="/login">{t("Connexion")}</a>
            <a className="os-menu-cta" href={start}>{startLabel}</a>
          </nav>
          <div className="os-nav-right">
            <a className="os-login" href="/login">{t("Connexion")}</a>
            <a className="os-cta" href={start}>{signup ? t("Commencer") : t("Se connecter")}</a>
            <button type="button" className="os-burger" aria-label={t("Menu")} aria-expanded={menu} onClick={() => setMenu(!menu)}>{menu ? <X size={20} /> : <Menu size={20} />}</button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="os-hero">
        <span className="os-float f1" aria-hidden="true"><NetworkIcon network="instagram" size={18} /></span>
        <span className="os-float f2" aria-hidden="true"><MessageCircle size={18} /></span>
        <span className="os-float f3" aria-hidden="true"><NetworkIcon network="tiktok" size={18} /></span>
        <span className="os-float f4" aria-hidden="true"><NetworkIcon network="youtube" size={18} /></span>
        <span className="os-float f5" aria-hidden="true"><NetworkIcon network="facebook" size={18} /></span>
        <span className="os-float f6" aria-hidden="true"><FileText size={18} /></span>
        <div className="os-wrap os-hero-in">
          <a className="os-news" href="#produit"><span className="os-news-tag"><Sparkles size={11} />{t("NOUVEAU")}</span>{t("Publication automatique sur TikTok et YouTube")}</a>
          <h1>{t("Produisez, faites valider et publiez le contenu de vos clients")}</h1>
          <p className="os-lead">{t("Un seul espace pour votre équipe et vos clients. Tâches, validations, réseaux sociaux, réunions et factures.")}</p>
          <div className="os-hero-cta">
            <a className="os-btn dark" href={start}>{startLabel} <ArrowRight size={15} className="os-arrow" /></a>
            <a className="os-btn light" href="#produit">
              <span className="os-mini-icons" aria-hidden="true"><NetworkIcon network="instagram" size={13} /><NetworkIcon network="tiktok" size={13} /><NetworkIcon network="youtube" size={13} /></span>
              {t("Pour les agences")}
            </a>
          </div>
          <small className="os-micro">{t("{days} jours gratuits · Sans carte bancaire", { days: trialDays })}</small>
        </div>

        <div className="os-wrap" id="produit">
          <div className="os-tabs" role="tablist" aria-label={t("Aperçu de l’application")}>
            {shots.map((s, i) => (
              <button key={s.id} type="button" role="tab" aria-selected={shot === i} className={shot === i ? "on" : ""} onClick={() => setShot(i)}>{t(s.label)}</button>
            ))}
          </div>
          <div className="os-demo">
            <span className="os-demo-pill"><span className="os-dot" />{t("Un espace, toute l’agence")}</span>
            {/* eslint-disable-next-line @next/next/no-img-element -- static screenshots, sized by CSS */}
            <img key={shots[shot].id} src={`/landing/${shots[shot].id}.webp`} alt={t(shots[shot].label)} width={1600} height={1000} />
          </div>
        </div>
      </section>

      {/* Logos */}
      <section className="os-wrap os-logos">
        <p className="os-eyebrow center">{t("Connecté aux outils que vous utilisez déjà")}</p>
        <div className="os-logo-grid">
          {networks.map((n) => <span key={n}><NetworkIcon network={n} size={20} />{networkName(n)}</span>)}
          <span><MessageCircle size={20} />WhatsApp</span>
          <span><FolderOpen size={20} />Google Drive</span>
          <span><Mail size={20} />{t("E-mail")}</span>
          <span><Video size={20} />{t("Visio")}</span>
        </div>
      </section>

      {/* 01 */}
      <section className="os-wrap os-section" id="fonctionnalites">
        <div className="os-head-row">
          <div>
            <span className="os-pill"><b>01</b>{t("Produire et valider")}</span>
            <h2>{t("Du brief à")} <span className="os-chip-inline"><NetworkIcon network="instagram" size={22} />Instagram</span>{t(", validé")}<br />{t("et publié à l’heure")}</h2>
            <p className="os-sub">{t("Vos créatifs déposent, vos clients valident, l’application publie. Sans relance, sans groupe WhatsApp, sans fichier perdu.")}</p>
            <div className="os-checks">
              <span><i className="ok" />{t("Délai de validation personnalisable")}</span>
              <span><i className="ok" />{t("Tours de retouche comptés")}</span>
              <span><i className="ok" />{t("Client prévenu par WhatsApp")}</span>
            </div>
          </div>
          <div className="os-links-float" aria-hidden="true">
            <span className="r1"><BadgeCheck size={15} />{t("Validation client")} <ArrowUpRight size={13} /></span>
            <span className="r2"><Megaphone size={15} />{t("Plan éditorial")} <ArrowUpRight size={13} /></span>
            <span className="r3"><FileText size={15} />{t("Devis et factures")} <ArrowUpRight size={13} /></span>
          </div>
        </div>

        <div className="os-three">
          <article className="os-card">
            <h3>{t("Pour l’équipe")}</h3>
            <p>{t("Pour les créatifs : chaque tâche a son client, son échéance et son historique.")}</p>
            <div className="os-chipbox g1">
              {["Kanban", "Calendrier", "Chronomètre", "Fichiers", "Messages"].map((c) => <span key={c}>{t(c)}</span>)}<span className="more">+4</span>
            </div>
          </article>
          <article className="os-card">
            <h3>{t("Pour vos clients")}</h3>
            <p>{t("Pour les marques : un portail où tout valider, demander et suivre.")}</p>
            <div className="os-chipbox g2">
              {["Valider", "Demander", "Réunions", "Planning", "Rapports"].map((c) => <span key={c}>{t(c)}</span>)}<span className="more">+3</span>
            </div>
          </article>
          <article className="os-card">
            <h3>{t("Publier sur les réseaux")}</h3>
            <p>{t("Pour les social media managers : maintenant ou à l’heure prévue.")}</p>
            <div className="os-chipbox g3">
              {networks.map((n) => <span key={n}><NetworkIcon network={n} size={13} />{networkName(n)}</span>)}<span className="more">{t("Répéter")}</span>
            </div>
          </article>
        </div>

        <div className="os-log">
          <div className="os-log-tabs">
            <div role="tablist" aria-label={t("Le parcours d’un livrable")}>
              {timeline.map(([name], i) => <button key={name} type="button" role="tab" aria-selected={tab === i} className={tab === i ? "on" : ""} onClick={() => setTab(i)}>{t(name)}</button>)}
            </div>
            <span className="os-log-meta">{t("Historique")} <ChevronDown size={13} /></span>
          </div>
          <div className="os-log-body">
            <Copy size={14} className="os-log-copy" aria-hidden="true" />
            {timeline[tab][1].map(([time, who, what], i) => (
              <div key={i} className={`os-log-line${i === timeline[tab][1].length - 1 ? " hl" : ""}`}>
                <span className="time">{time}</span><span className="who">{who === "Studio" || who === "The One Space" ? t(who) : who}</span><span className="what">{t(what)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="os-split">
          <div className="os-split-text">
            <span className="os-eyebrow">{t("Avec l’IA")}</span>
            <h3>{t("Écrivez vos contenus")} <em>{t("avec l’IA.")}</em></h3>
            <ul className="os-list">
              <li><i className="ok" />{t("Légendes et titres dans la langue du client")}</li>
              <li><i className="ok" />{t("À partir de vos notes et de vos visuels")}</li>
              <li><i className="ok" />{t("Un assistant qui connaît vos tâches et vos clients")}</li>
            </ul>
            <span className="os-field-label">{t("Votre brief")}</span>
            <div className="os-field">{t("Lancement du nouveau café, ton chaleureux, 3 hashtags")}</div>
            <span className="os-field-label">{t("Langue du client")}</span>
            <div className="os-field">{t("Français · Arabe · Anglais")}</div>
          </div>
          <div className="os-tiles">
            {aiTiles.map(({ icon: Icon, label }) => (
              <div key={label} className="os-tile"><Icon size={18} /><span>{t(label)}</span><ArrowUpRight size={13} className="os-tile-arrow" /></div>
            ))}
          </div>
        </div>

        <div className="os-split">
          <div className="os-split-text">
            <span className="os-eyebrow">{t("Intégré")}</span>
            <h3>{t("Du portail client à la publication,")} <em>{t("sans copier-coller.")}</em></h3>
            <span className="os-field-label spaced">{t("Portail, messages et destinations")}</span>
            <div className="os-chipbox g1 wide">
              {["Portail client", "WhatsApp", "E-mail", "Google Drive", "Instagram", "Facebook", "TikTok", "YouTube"].map((c) => <span key={c}>{t(c)}</span>)}<span className="more">+3</span>
            </div>
          </div>
          <div className="os-flow">
            <small className="os-flow-title"><span className="os-dot" />{t("Une demande client · de l’idée à la publication")}</small>
            <div className="os-step"><em>{t("Source")}</em><span className="os-step-icon"><Inbox size={16} /></span><div><b>1 · {t("Demande du client")}</b><small>{t("Envoyée depuis son portail.")}</small></div></div>
            <div className="os-step"><em>{t("Production")}</em><span className="os-step-icon gold"><BadgeCheck size={16} /></span><div><b>2 · {t("Créé et validé")}</b><small>{t("Par votre équipe, puis par le client.")}</small></div></div>
            <div className="os-step"><em>{t("Destination")}</em><span className="os-step-icon light"><NetworkIcon network="tiktok" size={16} /></span><div><b>3 · {t("Publié sur TikTok")}</b><small>{t("Vendredi à 18:00.")}</small></div></div>
            <div className="os-dots" aria-hidden="true"><i className="on" /><i /><i /></div>
          </div>
        </div>
      </section>

      {/* Statement */}
      <section className="os-wrap os-quote">
        <div>
          <span className="os-quote-mark" aria-hidden="true">“</span>
          <blockquote>{t("Nous avons construit The One Space pour notre propre agence, pour arrêter de courir après les validations dans WhatsApp et les fichiers dans Drive. Aujourd’hui, nous l’ouvrons à toutes les agences.")}</blockquote>
          <p className="os-quote-who">
            {/* eslint-disable-next-line @next/next/no-img-element -- SVG mark */}
            <img src="/favicon.svg" alt="" />
            <span><b>The One Core</b>, {t("agence de communication")}</span>
          </p>
        </div>
        <div className="os-quote-side">
          <p>{t("Créez votre espace en deux minutes.")}</p>
          <a className="os-btn dark small" href={start}>{startLabel} <ArrowRight size={13} className="os-arrow" /></a>
        </div>
      </section>

      {/* 02 */}
      <section className="os-wrap os-section">
        <span className="os-pill"><b>02</b>{t("Votre marque")}</span>
        <h2>{t("Votre marque, partout.")}<br /><em>{t("Vos clients s’y retrouvent.")}</em></h2>
        <p className="os-sub">{t("Votre logo et votre couleur remplacent les nôtres : dans l’application, le portail de vos clients, les e-mails, les devis et les factures.")}</p>
        <div className="os-brand-grid">
          <div className="os-brand-cards">
            {brandCards.map(({ icon: Icon, title, text }) => (
              <article key={title} className="os-card small"><span className="os-icon"><Icon size={16} /></span><ArrowUpRight size={13} className="os-card-arrow" /><h4>{t(title)}</h4><p>{t(text)}</p></article>
            ))}
          </div>
          <div className="os-shot gold">
            <span className="os-demo-pill"><span className="os-dot" />{t("Le portail de votre client")}</span>
            {/* eslint-disable-next-line @next/next/no-img-element -- static screenshot */}
            <img src="/landing/portal.webp" alt={t("Portail client")} width={1600} height={1000} loading="lazy" />
          </div>
        </div>
        <div className="os-grid3">
          {smallCards.map(({ icon: Icon, title, text }) => (
            <article key={title} className="os-card small"><span className="os-icon"><Icon size={16} /></span><ArrowUpRight size={13} className="os-card-arrow" /><h4>{t(title)}</h4><p>{t(text)}</p></article>
          ))}
        </div>
      </section>

      {/* 03 */}
      <section className="os-wrap os-section">
        <div className="os-head-row">
          <div>
            <span className="os-pill"><b>03</b>{t("Grandir")}</span>
            <h2>{t("Publication et statistiques,")}<br /><em>{t("pour chaque client.")}</em></h2>
            <p className="os-sub">{t("Publiez sur quatre réseaux depuis le même écran, puis lisez les chiffres de chaque compte pour décider de la suite.")}</p>
            <div className="os-checks">
              <span><i className="ok" />{t("Publication programmée")}</span>
              <span><i className="ok" />{t("Rapport mensuel par client")}</span>
              <span><i className="ok" />{t("Audit Instagram en PDF")}</span>
            </div>
          </div>
          <div className="os-stats-float" aria-hidden="true">
            <span className="s1"><NetworkIcon network="instagram" size={15} />{t("Reel publié · 18:00")}</span>
            <span className="s2"><NetworkIcon network="tiktok" size={15} />{t("Vidéo programmée")}</span>
            <span className="s3"><NetworkIcon network="youtube" size={15} />{t("Short en ligne")}</span>
            <span className="s4"><NetworkIcon network="facebook" size={15} />{t("Album publié")}</span>
            <span className="s5"><BarChart3 size={15} />{t("Rapport prêt")}</span>
          </div>
        </div>

        <div className="os-prompt-card">
          <div className="os-prompt-top">
            <div className="os-seg">
              {["Agences", "Marques", "Freelances"].map((p, i) => <button key={p} type="button" className={persona === i ? "on" : ""} onClick={() => setPersona(i)}>{t(p)}</button>)}
            </div>
            <div className="os-seg-links"><span>{t("Réseaux sociaux")} <ArrowUpRight size={11} /></span><span>{t("Statistiques")} <ArrowUpRight size={11} /></span></div>
          </div>
          <div className="os-prompt">
            <p><Sparkles size={16} className="os-gold" /> {t(prompts[persona])}<span className="os-caret" /></p>
            <div className="os-prompt-foot"><span><Bot size={12} />{t("Assistant connecté à votre espace")}</span><span className="os-send"><Send size={13} /></span></div>
          </div>
        </div>

        <div className="os-split image">
          <div className="os-split-text">
            <h3>{t("Grandissez avec vos chiffres.")}</h3>
            <p className="os-sub small">{t("Chaque compte de chaque client, comparé à la période précédente. Chaque chiffre indique quoi faire ensuite.")}</p>
            <ul className="os-list">
              <li><i className="ok" />{t("Vos meilleures publications, classées par engagement")}</li>
              <li><i className="ok" />{t("Abonnés, portée et interactions semaine après semaine")}</li>
              <li><i className="ok" />{t("Un rapport à partager avec le client")}</li>
            </ul>
            <a className="os-outline" href={start}>{t("Voir les statistiques")} <ArrowUpRight size={13} /></a>
          </div>
          <div className="os-shot dark">
            {/* eslint-disable-next-line @next/next/no-img-element -- static screenshot */}
            <img src="/landing/dashboard.webp" alt={t("Tableau de bord")} width={1600} height={1000} loading="lazy" />
          </div>
        </div>
      </section>

      {/* 04 */}
      <section className="os-wrap os-section" id="securite">
        <span className="os-pill"><b>04</b>{t("Sécurité")}</span>
        <h2>{t("Chaque entreprise dans son espace.")}<br /><em>{t("Vos données restent les vôtres.")}</em></h2>
        <p className="os-sub">{t("Une infrastructure pensée pour les agences : chaque client, chaque membre et chaque fichier à sa place.")}</p>
        <div className="os-checks">
          <span><i className="ok" />{t("Espaces isolés")}</span>
          <span><i className="ok" />{t("Six rôles d’accès")}</span>
          <span><i className="ok" />{t("Suppression sur demande")}</span>
        </div>
        <div className="os-split image tall">
          <div className="os-split-text">
            <span className="os-eyebrow">{t("Rôles et accès")}</span>
            <h3>{t("Chacun voit ce qu’il doit voir.")}</h3>
            <p className="os-sub small">{t("Un membre voit ses tâches, un client voit ses contenus, le propriétaire voit tout. Les factures restent entre vous et votre client.")}</p>
            <div className="os-tags">
              {["Propriétaire", "Administrateur", "Membre", "Social media manager", "Observateur", "Client"].map((r) => <span key={r}>{t(r)}</span>)}
            </div>
          </div>
          <div className="os-shot gold">
            {/* eslint-disable-next-line @next/next/no-img-element -- static screenshot */}
            <img src="/landing/board.webp" alt={t("Tâches")} width={1600} height={1000} loading="lazy" />
          </div>
        </div>
        <div className="os-grid3">
          {securityCards.map(({ icon: Icon, title, text }) => (
            <article key={title} className="os-card small"><span className="os-icon"><Icon size={16} /></span><h4>{t(title)}</h4><p>{t(text)}</p></article>
          ))}
          <a className="os-card small os-more" href="/confidentialite">{t("Politique de confidentialité")} <ArrowUpRight size={13} /></a>
        </div>
      </section>

      {/* Use cases */}
      <section className="os-wrap os-section">
        <span className="os-eyebrow">{t("Cas d’usage")}</span>
        <h2>{t("Comment les équipes travaillent")} <em>{t("avec The One Space.")}</em></h2>
        <p className="os-sub">{t("Des agences, des studios et des freelances qui produisent pour leurs clients, du premier brief à la facture.")}</p>
        <div className="os-masonry">
          {uses.map(({ tag, tone, text, who }) => (
            <article key={tag} className="os-story">
              <span className={`os-tag ${tone}`}>{t(tag)}</span>
              <p>{t(text)}</p>
              <footer><span className="os-avatar">{t(who).slice(0, 1)}</span><div><b>{t(who)}</b><small>{t("Avec The One Space")}</small></div></footer>
            </article>
          ))}
        </div>
      </section>

      {/* Numbers */}
      <section className="os-wrap os-section">
        <span className="os-eyebrow">{t("Inclus")}</span>
        <h2>{t("Tout est inclus.")} <em>{t("Dans chaque plan.")}</em></h2>
        <p className="os-sub">{t("Les mêmes fonctionnalités pour tous : seule la taille de votre équipe et de votre portefeuille change.")}</p>
        <div className="os-numbers">
          <div className="n1"><span className="os-num"><NetworkIcon network="instagram" size={14} />4</span><small>{t("réseaux sociaux")}</small></div>
          <div className="n2"><span className="os-num"><Clock3 size={14} />{t("Sur mesure")}</span><small>{t("délai de validation")}</small></div>
          <div className="n3"><span className="os-num"><Languages size={14} />3</span><small>{t("langues")}</small></div>
          <div className="n4"><span className="os-num"><Globe size={14} />{trialDays}</span><small>{t("jours d’essai gratuit")}</small></div>
        </div>
      </section>

      {/* Pricing */}
      <section className="os-wrap os-section" id="tarifs">
        <span className="os-eyebrow">{t("Tarifs")}</span>
        <h2>{t("{days} jours gratuits.", { days: trialDays })} <em>{t("Sans carte.")}</em></h2>
        <p className="os-sub">{t("Testez tout, puis choisissez le plan qui suit votre équipe. Vos clients ne paient jamais.")}</p>
        <div className="os-free">
          <div><b>{t("Essai")}</b><small>{t("0 MAD · {days} jours", { days: trialDays })}</small></div>
          <p><b>{t("Toutes les fonctionnalités")}</b><small>{t("3 membres · 5 clients · 500 Mo · 50 demandes à l’IA")}</small></p>
          <a className="os-btn outline small" href={start}>{startLabel} <ArrowRight size={13} className="os-arrow" /></a>
        </div>
        <div className="os-plan-switch" role="tablist" aria-label={t("Choisir un plan")}>
          {paidPlanIds.map((id) => (
            <button key={id} type="button" role="tab" aria-selected={shownPlan === id} className={shownPlan === id ? "on" : ""} onClick={() => setShownPlan(id)}>
              <b>{t(plans[id].name)}</b><small>{plans[id].priceMad.toLocaleString("fr-FR")} MAD</small>
            </button>
          ))}
        </div>
        <div className="os-prices">
          {paidPlanIds.map((id) => {
            const plan = plans[id];
            const featured = id === "pro";
            return (
              <article key={id} className={`os-price${featured ? " featured" : ""}${shownPlan === id ? " is-picked" : ""}`}>
                {featured && <span className="os-popular">{t("POPULAIRE")}</span>}
                <h3>{t(plan.name)}</h3>
                <p className="os-amount"><b>{plan.priceMad.toLocaleString("fr-FR")}</b> <span>{t("MAD / mois")}</span></p>
                <a className={`os-btn ${featured ? "dark" : "outline"} block`} href={start}>{signup ? t("Commencer") : t("Se connecter")} <ArrowRight size={13} className="os-arrow" /></a>
                <ul>
                  <li><Check size={14} /><div>{t("{n} membres de l’équipe", { n: plan.limits.members })}<small>{t("Le propriétaire compris")}</small></div></li>
                  <li><Check size={14} /><div>{t("{n} clients", { n: plan.limits.clients })}<small>{t("Portails clients gratuits")}</small></div></li>
                  <li><Check size={14} /><div>{t("{size} de fichiers", { size: storage(plan.limits.storageMb) })}<small>{t("Livrables, PDF, messages vocaux")}</small></div></li>
                  <li><Check size={14} /><div>{t("{n} demandes à l’IA par mois", { n: plan.limits.aiPerMonth.toLocaleString("fr-FR") })}<small>{t("Légendes, titres, assistant")}</small></div></li>
                  <li><Check size={14} /><div>{t("Toutes les fonctionnalités")}<small>{t("Publication, réunions, factures, rapports")}</small></div></li>
                </ul>
              </article>
            );
          })}
        </div>
        <p className="os-fine">{t("Chaque plan comprend la publication sur les réseaux, les réunions, les devis et factures, et le portail client.")}</p>
        <div className="os-two">
          <article className="os-price wide">
            <h3>{t("Portails clients")}</h3>
            <p className="os-amount"><b>{t("Gratuit")}</b> <span>{t("pour vos clients")}</span></p>
            <ul>
              <li><Check size={14} /><div>{t("Valider, demander, suivre, se réunir")}</div></li>
              <li><Check size={14} /><div>{t("Prévenu par WhatsApp ou e-mail")}</div></li>
            </ul>
            <span className="os-field-label">{t("Réseaux pris en charge")}</span>
            <div className="os-net-row">{networks.map((n) => <span key={n}><NetworkIcon network={n} size={15} /></span>)}<span><MessageCircle size={15} /></span></div>
          </article>
          <article className="os-price wide">
            <h3>{t("Sur mesure")}</h3>
            <p className="os-amount serif">{t("Contactez-nous")}</p>
            <ul>
              <li><Check size={14} /><div>{t("Plus de membres, de clients ou de stockage")}</div></li>
              <li><Check size={14} /><div>{t("Accompagnement et formation de votre équipe")}</div></li>
              <li><Check size={14} /><div>{t("Paiement par virement ou par carte")}</div></li>
            </ul>
            <a className="os-btn outline block" href={`mailto:${company.email}`}>{t("Nous contacter")}</a>
          </article>
        </div>
      </section>

      {/* FAQ */}
      <section className="os-wrap os-section os-faq" id="questions">
        <div>
          <span className="os-eyebrow">{t("Questions")}</span>
          <h2>{t("Les questions")} <em>{t("habituelles.")}</em></h2>
          <p className="os-sub">{t("Une autre question ?")} <a href={`mailto:${company.email}`}>{t("Écrivez-nous")}</a>{t(", nous répondons rapidement.")}</p>
        </div>
        <div className="os-faq-list">
          {faqs.map(([q, a], i) => (
            <div key={q} className={`os-faq-item${faq === i ? " open" : ""}`}>
              <button type="button" aria-expanded={faq === i} onClick={() => setFaq(faq === i ? null : i)}>{t(q)}<ChevronDown size={15} /></button>
              {faq === i && <p>{t(a, { days: trialDays })}</p>}
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="os-footer" id="entreprise">
        <div className="os-wrap os-footer-in">
          <div className="os-footer-brand">
            {/* eslint-disable-next-line @next/next/no-img-element -- SVG logo */}
            <img src="/the-one-core-logo-dark.svg" alt="The One Core" />
            <p>{t("The One Space — l’espace de travail des agences et de leurs clients.")}</p>
            <div className="os-social">
              <a href={company.website} target="_blank" rel="noopener noreferrer" aria-label={t("Site web")}><Globe size={15} /></a>
              <a href={`mailto:${company.email}`} aria-label={t("E-mail")}><Mail size={15} /></a>
              <a href={company.whatsapp} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp"><MessageCircle size={15} /></a>
              <a href={company.phoneHref} aria-label={t("Téléphone")}><Phone size={15} /></a>
            </div>
            <span className="os-foot-title">{t("Langue")}</span>
            <LanguageSwitch compact />
          </div>
          <div>
            <span className="os-foot-title">{t("Produit")}</span>
            <a href="#fonctionnalites">{t("Fonctionnalités")}</a>
            <a href="#securite">{t("Sécurité")}</a>
            <a href="#tarifs">{t("Tarifs")}</a>
            <a href="#questions">{t("Questions")}</a>
            <a href="/login">{t("Connexion")}</a>
            {signup && <a href={start}>{t("Créer un compte")}</a>}
          </div>
          <div>
            <span className="os-foot-title">{t("Aide et légal")}</span>
            <a href={`mailto:${company.email}`}>{t("Nous contacter")}</a>
            <a href={company.whatsapp} target="_blank" rel="noopener noreferrer">WhatsApp</a>
            <a href="/conditions">{t("Conditions d’utilisation")}</a>
            <a href="/confidentialite">{t("Politique de confidentialité")}</a>
            <a href="/suppression-des-donnees">{t("Suppression des données")}</a>
          </div>
          <div>
            <span className="os-foot-title">{t("Mentions légales")}</span>
            <dl className="os-legal">
              <div><dt>{t("Éditeur")}</dt><dd>{company.name}</dd></div>
              <div><dt>{t("Activité")}</dt><dd>{t(company.activity)}</dd></div>
              <div><dt>{t("Siège")}</dt><dd>{t(company.city)}</dd></div>
              <div><dt>ICE</dt><dd dir="ltr">{company.ice}</dd></div>
              <div><dt>RC</dt><dd dir="ltr">{company.rc}</dd></div>
              <div><dt>{t("Téléphone")}</dt><dd><a href={company.phoneHref} dir="ltr">{company.phone}</a></dd></div>
              <div><dt>{t("E-mail")}</dt><dd><a href={`mailto:${company.email}`}>{company.email}</a></dd></div>
              <div><dt>{t("Site web")}</dt><dd><a href={company.website} target="_blank" rel="noopener noreferrer">{company.websiteLabel}</a></dd></div>
            </dl>
          </div>
        </div>
        <div className="os-wrap os-bottom">
          <span>© {new Date().getFullYear()} The One Space · {t("par")} {company.name}. {t("Tous droits réservés.")}</span>
          <span>ICE {company.ice} · RC {company.rc} · {t(company.city)}</span>
        </div>
      </footer>
    </div>
  );
}
