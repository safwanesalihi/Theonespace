"use client";
// The public home page (app/page.tsx shows it to anyone signed out): what The One Space does, for whom,
// how it works and what it costs — then « Essai gratuit » (the company sign-up, when open) or « Se
// connecter ». Prices come from lib/plans.ts, the same numbers the app enforces. No screenshots: the
// previews are drawn here, so they stay sharp and never show anyone's data.
import { useEffect, useState } from "react";
import {
  ArrowRight, BarChart3, Bot, CalendarDays, Check, CheckCircle2, Clock3, FileText, Globe2, Inbox, LayoutGrid,
  Lock, Megaphone, Menu, MessageCircle, Palette, ShieldCheck, Sparkles, Users, Video, X,
} from "lucide-react";
import { useI18n } from "@/app/locale-provider";
import LanguageSwitch from "@/app/language-switch";
import Copyright from "@/app/copyright";
import { paidPlanIds, plans, trialDays } from "@/lib/plans";
import "./landing.css";

const features = [
  { icon: LayoutGrid, title: "Tâches et projets", text: "Tableau, Kanban et calendrier : chaque livrable a son client, son échéance, son responsable et son historique." },
  { icon: CheckCircle2, title: "Validation client", text: "Envoyez un livrable, le client valide ou demande des retouches. Tours comptés, validation tacite après 48 h." },
  { icon: Users, title: "Portail client", text: "Chaque client a son espace : ses contenus à valider, son planning, ses demandes, ses réunions. Rien d’autre." },
  { icon: Megaphone, title: "Plan éditorial et publication", text: "Planifiez et publiez sur Instagram, Facebook, TikTok et YouTube — carrousels, reels, stories, publications répétées." },
  { icon: Sparkles, title: "Rédaction par l’IA", text: "Légendes, titres et corrections dans la langue du client, à partir de vos notes et de vos visuels." },
  { icon: Video, title: "Réunions intégrées", text: "Appels vidéo ou audio avec vos clients, directement dans l’espace, sans lien externe à partager." },
  { icon: BarChart3, title: "Statistiques et audit Instagram", text: "Abonnés, portée, engagement, meilleurs posts — et un audit PDF de n’importe quel compte Instagram." },
  { icon: FileText, title: "Devis, factures, contrats", text: "Numérotation automatique, PDF à votre marque, statut de paiement suivi dans le même espace." },
  { icon: Clock3, title: "Temps et activité", text: "Le chronomètre tourne quand une tâche est en cours : vous savez où passe le temps de l’équipe." },
  { icon: Inbox, title: "Demandes clients", text: "Vos clients vous écrivent depuis leur portail ; vous acceptez en tâche en un clic." },
  { icon: MessageCircle, title: "Notifications WhatsApp et e-mail", text: "Le client est prévenu quand un contenu attend sa validation, là où il lit vraiment ses messages." },
  { icon: Palette, title: "À votre marque", text: "Votre logo et votre couleur dans l’application, le portail, les e-mails et les PDF." },
];

const faqs = [
  { q: "À qui s’adresse The One Space ?", a: "Aux agences de communication, studios créatifs, social media managers et freelances qui produisent du contenu pour des clients et doivent le faire valider." },
  { q: "Mes clients doivent-ils payer ou installer quelque chose ?", a: "Non. Vous les invitez depuis l’espace ; ils reçoivent un accès à leur portail, dans leur navigateur, gratuitement." },
  { q: "Comment se passe l’essai gratuit ?", a: "{days} jours avec toutes les fonctionnalités, sans carte bancaire. À la fin, choisissez un plan ; vos données restent consultables en attendant." },
  { q: "Comment payer ?", a: "Choisissez votre plan depuis l’espace : The One Core vous contacte pour le règlement (virement ou carte) et active le plan." },
  { q: "Dans quelles langues ?", a: "Français, anglais et arabe, pour vous comme pour vos clients — chacun choisit la sienne." },
  { q: "Mes données sont-elles protégées ?", a: "Chaque entreprise a son espace séparé. Mots de passe hachés, connexions protégées, et vous pouvez demander la suppression de vos données à tout moment." },
];

function AppPreview() {
  const { t } = useI18n();
  const columns = [
    { name: "À faire", tone: "todo", cards: [["Reel lancement", "Café Atlas"], ["Carrousel promo", "Nour Beauty"]] },
    { name: "En cours", tone: "doing", cards: [["Shooting produit", "Riad Zitoun"]] },
    { name: "En validation", tone: "review", cards: [["Affiche ramadan", "Café Atlas"], ["Story offre", "Maison Lina"]] },
    { name: "Validé", tone: "done", cards: [["Logo animé", "Nour Beauty"]] },
  ];
  return (
    <div className="lp-window" aria-hidden="true">
      <div className="lp-window-bar"><i /><i /><i /><span>The One Space</span></div>
      <div className="lp-window-body">
        <aside className="lp-mock-side">
          <b className="lp-mock-logo" dir="ltr">Studio Nour<span>.</span></b>
          {["Accueil", "Tâches", "Clients", "Social", "Réunions", "Équipe"].map((item, i) => (
            <span key={item} className={i === 1 ? "on" : ""}>{t(item)}</span>
          ))}
        </aside>
        <div className="lp-mock-main">
          <div className="lp-mock-head"><strong>{t("Tâches")}</strong><span className="lp-mock-btn">+ {t("Nouvelle tâche")}</span></div>
          <div className="lp-mock-board">
            {columns.map((column) => (
              <div key={column.name} className="lp-mock-col">
                <small className={`lp-dot ${column.tone}`}>{t(column.name)}</small>
                {column.cards.map(([name, client]) => (
                  <div key={name} className="lp-mock-card"><b>{t(name)}</b><span>{client}</span></div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="lp-float lp-float-approve">
        <CheckCircle2 size={18} />
        <div><b>{t("Validé par le client")}</b><span>{t("Affiche ramadan · il y a 2 min")}</span></div>
      </div>
      <div className="lp-float lp-float-post">
        <CalendarDays size={18} />
        <div><b>{t("Publié sur Instagram")}</b><span>{t("Reel lancement · 18:00")}</span></div>
      </div>
    </div>
  );
}

function ApprovalPreview() {
  const { t } = useI18n();
  return (
    <div className="lp-panel" aria-hidden="true">
      <div className="lp-panel-head"><b>{t("Affiche ramadan")}</b><span className="lp-chip review">{t("En validation")}</span></div>
      <div className="lp-art"><span>{t("Aperçu du livrable")}</span></div>
      <ol className="lp-timeline">
        <li className="done"><b>{t("Envoyé au client")}</b><span>{t("Lundi 10:12")}</span></li>
        <li className="done"><b>{t("Retouche demandée · tour 1/2")}</b><span>{t("« Le logo un peu plus grand »")}</span></li>
        <li className="now"><b>{t("Nouvelle version envoyée")}</b><span>{t("Validation tacite dans 31 h")}</span></li>
      </ol>
      <div className="lp-panel-actions"><span className="lp-mini-btn ghost">{t("Demander une retouche")}</span><span className="lp-mini-btn">{t("Valider")}</span></div>
    </div>
  );
}

function SocialPreview() {
  const { t } = useI18n();
  const days = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
  const posts: Record<number, [string, string][]> = { 0: [["ig", "Reel"]], 2: [["fb", "Album"], ["ig", "Story"]], 3: [["tt", "Vidéo"]], 5: [["yt", "Short"]], 6: [["ig", "Carrousel"]] };
  return (
    <div className="lp-panel" aria-hidden="true">
      <div className="lp-panel-head"><b>{t("Plan éditorial")}</b><span className="lp-chip">{t("Cette semaine")}</span></div>
      <div className="lp-week">
        {days.map((d, i) => (
          <div key={d} className="lp-day">
            <small>{t(d)}</small>
            {(posts[i] ?? []).map(([net, label]) => <span key={label} className={`lp-post ${net}`}>{t(label)}</span>)}
          </div>
        ))}
      </div>
      <div className="lp-caption">
        <Bot size={16} />
        <p>{t("« Le goût du vrai café, à deux pas de la médina. Venez goûter notre nouvelle torréfaction ☕ »")}</p>
      </div>
    </div>
  );
}

function PortalPreview() {
  const { t } = useI18n();
  return (
    <div className="lp-panel lp-portal" aria-hidden="true">
      <div className="lp-portal-top"><b>Café Atlas</b><span>{t("Portail client")}</span></div>
      <div className="lp-portal-grid">
        <div><small>{t("À valider")}</small><strong>2</strong></div>
        <div><small>{t("Publiés ce mois")}</small><strong>14</strong></div>
        <div><small>{t("Prochaine réunion")}</small><strong>{t("Jeu. 11:00")}</strong></div>
      </div>
      <div className="lp-portal-row"><span className="lp-chip review">{t("À valider")}</span><b>{t("Story offre du week-end")}</b></div>
      <div className="lp-portal-row"><span className="lp-chip done">{t("Validé")}</span><b>{t("Reel lancement")}</b></div>
      <div className="lp-swatches">{["#efb849", "#3a7bd5", "#1e9e8f", "#d6336c", "#20232a"].map((c) => <i key={c} style={{ background: c }} />)}<span>{t("Vos couleurs, votre logo")}</span></div>
    </div>
  );
}

export default function Landing({ signup }: { signup: boolean }) {
  const { t, dir } = useI18n();
  const [menu, setMenu] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on(); window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  const start = signup ? "/login?mode=signup" : "/login";
  const startLabel = signup ? t("Essai gratuit de {days} jours", { days: trialDays }) : t("Se connecter");
  const links = [["#fonctionnalites", "Fonctionnalités"], ["#comment", "Comment ça marche"], ["#tarifs", "Tarifs"], ["#faq", "Questions"]];

  return (
    <div className="lp" dir={dir}>
      <header className={`lp-nav${scrolled ? " scrolled" : ""}`}>
        <div className="lp-wrap lp-nav-in">
          <a href="#top" className="lp-brand" dir="ltr" aria-label="The One Space">The One Space<span>.</span></a>
          <nav className={`lp-links${menu ? " open" : ""}`} aria-label={t("Navigation")}>
            {links.map(([href, label]) => <a key={href} href={href} onClick={() => setMenu(false)}>{t(label)}</a>)}
            <div className="lp-links-mobile">
              <a className="lp-btn ghost" href="/login">{t("Se connecter")}</a>
              {signup && <a className="lp-btn" href={start}>{startLabel}</a>}
            </div>
          </nav>
          <div className="lp-nav-actions">
            <LanguageSwitch compact />
            <a className="lp-signin" href="/login">{t("Se connecter")}</a>
            {signup && <a className="lp-btn small" href={start}>{t("Essai gratuit")}</a>}
            <button type="button" className="lp-menu" aria-expanded={menu} aria-label={t("Menu")} onClick={() => setMenu(!menu)}>{menu ? <X size={20} /> : <Menu size={20} />}</button>
          </div>
        </div>
      </header>

      <main id="top">
        <section className="lp-hero">
          <div className="lp-wrap">
            <span className="lp-eyebrow"><ShieldCheck size={14} />{t("Par The One Core, agence de communication")}</span>
            <h1>{t("Produisez, faites valider, publiez.")} <em>{t("Au même endroit.")}</em></h1>
            <p className="lp-lead">{t("The One Space réunit votre équipe et vos clients : tâches, validations, plan éditorial, publication sur les réseaux, réunions et factures — sans les allers-retours WhatsApp, Drive et Excel.")}</p>
            <div className="lp-cta">
              <a className="lp-btn big" href={start}>{startLabel}<ArrowRight size={18} className="lp-arrow" /></a>
              <a className="lp-btn big ghost" href="#fonctionnalites">{t("Voir les fonctionnalités")}</a>
            </div>
            <ul className="lp-trust">
              {signup && <li><Check size={15} />{t("Sans carte bancaire")}</li>}
              <li><Check size={15} />{t("Vos clients gratuits")}</li>
              <li><Globe2 size={15} />{t("Français · English · العربية")}</li>
            </ul>
            <AppPreview />
          </div>
        </section>

        <section className="lp-strip">
          <div className="lp-wrap lp-strip-in">
            <div><strong>4</strong><span>{t("réseaux sociaux publiés directement")}</span></div>
            <div><strong>{t("48 h")}</strong><span>{t("avant la validation tacite d’un livrable")}</span></div>
            <div><strong>3</strong><span>{t("langues, pour vous et vos clients")}</span></div>
            <div><strong>1</strong><span>{t("espace pour l’équipe et les clients")}</span></div>
          </div>
        </section>

        <section className="lp-section" id="fonctionnalites">
          <div className="lp-wrap">
            <div className="lp-head">
              <span className="lp-kicker">{t("Fonctionnalités")}</span>
              <h2>{t("Tout le travail d’une agence, du brief à la publication")}</h2>
              <p>{t("Chaque outil parle aux autres : un contenu validé part dans le plan éditorial, une demande client devient une tâche, une réunion se lance depuis la fiche du client.")}</p>
            </div>
            <div className="lp-grid">
              {features.map(({ icon: Icon, title, text }) => (
                <article key={title} className="lp-card">
                  <span className="lp-icon"><Icon size={20} /></span>
                  <h3>{t(title)}</h3>
                  <p>{t(text)}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-section alt">
          <div className="lp-wrap lp-split">
            <div className="lp-split-text">
              <span className="lp-kicker">{t("Validation client")}</span>
              <h2>{t("Fini les « c’est validé ? » perdus dans les messages")}</h2>
              <p>{t("Le client voit le livrable, valide ou demande une retouche en un clic. Chaque tour est compté, chaque retour est gardé, et sans réponse sous 48 h le contenu est validé automatiquement.")}</p>
              <ul className="lp-list">
                <li><Check size={16} />{t("Tours de retouche inclus, dépassements signalés")}</li>
                <li><Check size={16} />{t("Verrouillage 7 jours avant la date de publication")}</li>
                <li><Check size={16} />{t("Notification WhatsApp ou e-mail au client")}</li>
              </ul>
            </div>
            <ApprovalPreview />
          </div>
        </section>

        <section className="lp-section">
          <div className="lp-wrap lp-split reverse">
            <div className="lp-split-text">
              <span className="lp-kicker">{t("Social media")}</span>
              <h2>{t("Planifiez la semaine, l’application publie à l’heure")}</h2>
              <p>{t("Connectez les comptes de vos clients une fois. Préparez les publications, faites-les valider, puis laissez The One Space publier sur Instagram, Facebook, TikTok et YouTube.")}</p>
              <ul className="lp-list">
                <li><Check size={16} />{t("Carrousels, reels, stories, shorts et albums")}</li>
                <li><Check size={16} />{t("Légendes proposées par l’IA, dans la langue de la marque")}</li>
                <li><Check size={16} />{t("Statistiques et rapports mensuels par client")}</li>
              </ul>
            </div>
            <SocialPreview />
          </div>
        </section>

        <section className="lp-section alt">
          <div className="lp-wrap lp-split">
            <div className="lp-split-text">
              <span className="lp-kicker">{t("Portail client")}</span>
              <h2>{t("Un espace pour chaque client, à votre image")}</h2>
              <p>{t("Vos clients se connectent à leur portail : ce qu’ils doivent valider, ce qui est publié, leurs demandes et leurs réunions. Avec votre logo et votre couleur, pas les nôtres.")}</p>
              <ul className="lp-list">
                <li><Check size={16} />{t("Chaque client ne voit que ses propres contenus")}</li>
                <li><Check size={16} />{t("Demandes et réunions depuis le portail")}</li>
                <li><Check size={16} />{t("E-mails et PDF à votre marque")}</li>
              </ul>
            </div>
            <PortalPreview />
          </div>
        </section>

        <section className="lp-section" id="comment">
          <div className="lp-wrap">
            <div className="lp-head">
              <span className="lp-kicker">{t("Comment ça marche")}</span>
              <h2>{t("Prêt en une après-midi")}</h2>
            </div>
            <ol className="lp-steps">
              <li><span>1</span><h3>{t("Créez votre espace")}</h3><p>{t("Le nom de votre agence, votre logo, votre couleur. {days} jours d’essai, sans carte.", { days: trialDays })}</p></li>
              <li><span>2</span><h3>{t("Invitez équipe et clients")}</h3><p>{t("Chacun son rôle : administrateur, créatif, social media manager, ou client sur son portail.")}</p></li>
              <li><span>3</span><h3>{t("Travaillez au même endroit")}</h3><p>{t("Tâches, validations, publications et factures : tout le monde voit où en est chaque livrable.")}</p></li>
            </ol>
          </div>
        </section>

        <section className="lp-section alt" id="tarifs">
          <div className="lp-wrap">
            <div className="lp-head">
              <span className="lp-kicker">{t("Tarifs")}</span>
              <h2>{t("Un prix simple, selon la taille de votre équipe")}</h2>
              <p>{t("Commencez par {days} jours d’essai gratuit. Vos clients ne paient jamais.", { days: trialDays })}</p>
            </div>
            <div className="lp-prices">
              {paidPlanIds.map((id) => {
                const plan = plans[id];
                const featured = id === "pro";
                return (
                  <article key={id} className={`lp-price${featured ? " featured" : ""}`}>
                    {featured && <span className="lp-badge">{t("Recommandé")}</span>}
                    <h3>{t(plan.name)}</h3>
                    <p className="lp-amount"><strong>{plan.priceMad.toLocaleString("fr-FR")}</strong> <span>{t("MAD / mois")}</span></p>
                    <ul>
                      <li><Check size={15} />{t("{n} membres de l’équipe", { n: plan.limits.members })}</li>
                      <li><Check size={15} />{t("{n} clients", { n: plan.limits.clients })}</li>
                      <li><Check size={15} />{t("{size} de fichiers", { size: plan.limits.storageMb >= 1024 ? `${Math.round(plan.limits.storageMb / 1024)} ${t("Go")}` : `${plan.limits.storageMb} ${t("Mo")}` })}</li>
                      <li><Check size={15} />{t("{n} demandes à l’IA par mois", { n: plan.limits.aiPerMonth.toLocaleString("fr-FR") })}</li>
                      <li><Check size={15} />{t("Toutes les fonctionnalités")}</li>
                    </ul>
                    <a className={`lp-btn${featured ? "" : " ghost"}`} href={start}>{signup ? t("Commencer l’essai") : t("Se connecter")}</a>
                  </article>
                );
              })}
            </div>
            <p className="lp-note"><Lock size={14} />{t("Portails clients illimités et gratuits sur tous les plans.")}</p>
          </div>
        </section>

        <section className="lp-section" id="faq">
          <div className="lp-wrap lp-faq-wrap">
            <div className="lp-head left">
              <span className="lp-kicker">{t("Questions")}</span>
              <h2>{t("Questions fréquentes")}</h2>
            </div>
            <div className="lp-faq">
              {faqs.map(({ q, a }) => (
                <details key={q}>
                  <summary>{t(q)}</summary>
                  <p>{t(a, { days: trialDays })}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-final">
          <div className="lp-wrap">
            <h2>{t("Votre prochaine campagne mérite mieux qu’un groupe WhatsApp.")}</h2>
            <p>{t("Créez votre espace en deux minutes et invitez votre premier client aujourd’hui.")}</p>
            <div className="lp-cta center">
              <a className="lp-btn big" href={start}>{startLabel}<ArrowRight size={18} className="lp-arrow" /></a>
              <a className="lp-btn big ghost dark" href="/login">{t("J’ai déjà un compte")}</a>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap lp-footer-in">
          <div>
            <a href="#top" className="lp-brand" dir="ltr">The One Space<span>.</span></a>
            <p>{t("L’espace de travail des agences et de leurs clients, par The One Core.")}</p>
          </div>
          <nav aria-label={t("Liens")}>
            <a href="#fonctionnalites">{t("Fonctionnalités")}</a>
            <a href="#tarifs">{t("Tarifs")}</a>
            <a href="/login">{t("Se connecter")}</a>
          </nav>
          <nav aria-label={t("Mentions")}>
            <a href="/conditions">{t("Conditions d’utilisation")}</a>
            <a href="/confidentialite">{t("Confidentialité")}</a>
            <a href="/suppression-des-donnees">{t("Suppression des données")}</a>
          </nav>
        </div>
        <div className="lp-wrap"><Copyright className="lp-copyright" /></div>
      </footer>
    </div>
  );
}
