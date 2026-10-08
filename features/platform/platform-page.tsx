"use client";
// « Plateforme » (The One Core's owner only, /api/platform): every company that signed up — its plan,
// its usage, any plan it asked for and its team — with the buttons to record a payment, extend a trial,
// suspend, help (owner password-reset link, read-only support access) or delete it for good.
import { Surface } from "@/components/ui/surface";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, ChevronDown, KeyRound, LifeBuoy, Loader2, LogOut, RefreshCw, Search, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/locale-provider";
import { storageLabel } from "@/features/plans/subscription-panel";
import { paidPlanIds, plans, type PaidPlanId, type Subscription, type SubscriptionState, type Usage } from "@/lib/plans";
import { roleLabels, isWorkspaceRole } from "@/lib/workspace";

type Company = { id: string; name: string; createdAt: string; ownerEmail: string | null; ownerName: string | null; subscription: Subscription; state: SubscriptionState; usage: Usage };
type Member = { userId: string; name: string | null; email: string | null; role: string; joinedAt: string; lastLoginAt: string | null; pending: boolean; support: boolean };
type Details = { id: string; name: string; members: Member[]; supportAccess: boolean };
type Filter = "all" | "trial" | "paying" | "stopped" | "requests";

const phaseLabels: Record<SubscriptionState["phase"], string> = {
  trial: "Essai gratuit", paid: "Actif", grace: "Paiement attendu", "trial-ended": "Essai terminé", expired: "Expiré", canceled: "Suspendu",
};
const filters: [Filter, string][] = [["all", "Toutes"], ["trial", "En essai"], ["paying", "Payantes"], ["stopped", "Arrêtées"], ["requests", "Demandes"]];
const matches = (c: Company, f: Filter) =>
  f === "all" ? true
  : f === "trial" ? c.state.phase === "trial"
  : f === "paying" ? c.state.active && c.subscription.plan !== "trial"
  : f === "stopped" ? !c.state.active
  : !!c.subscription.requestedPlan;

export default function PlatformPage({ onNotice, onError }: { onNotice: (text: string) => void; onError: (text: string) => void }) {
  const { t, date } = useI18n();
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [busy, setBusy] = useState("");
  const [pick, setPick] = useState<Record<string, { plan: PaidPlanId; months: number }>>({});
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [confirm, setConfirm] = useState("");
  const [resetLink, setResetLink] = useState("");

  const fetchCompanies = useCallback(async (): Promise<Company[] | null> => {
    const r = await fetch("/api/platform", { cache: "no-store" });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { onError(t(data.error || "Chargement impossible.")); return null; }
    return data.companies;
  }, [onError, t]);
  const load = async () => { const list = await fetchCompanies(); if (list) setCompanies(list); };
  useEffect(() => {
    let alive = true;
    void fetchCompanies().then((list) => { if (alive && list) setCompanies(list); });
    return () => { alive = false; };
  }, [fetchCompanies]);

  async function openDetails(id: string) {
    if (open === id) { setOpen(null); return; }
    setOpen(id); setDetails(null); setConfirm(""); setResetLink("");
    const r = await fetch(`/api/platform?workspace=${encodeURIComponent(id)}`, { cache: "no-store" });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { onError(t(data.error || "Chargement impossible.")); return; }
    setDetails(data.details);
  }

  async function act(company: Company, body: Record<string, unknown>, notice: string) {
    setBusy(company.id);
    try {
      const r = await fetch("/api/platform", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId: company.id, ...body }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Action impossible.");
      if (data.companies) setCompanies(data.companies);
      if (data.details) setDetails(data.details);
      if (data.reset?.devLink) setResetLink(data.reset.devLink);
      if (data.deleted) { setOpen(null); setDetails(null); }
      onNotice(t(notice, data.reset ? { email: data.reset.email } : undefined));
    } catch (e) { onError(t((e as Error).message)); }
    setBusy("");
  }

  const choice = (c: Company) => pick[c.id] ?? { plan: c.subscription.requestedPlan ?? (c.subscription.plan === "trial" ? "starter" : c.subscription.plan as PaidPlanId), months: 1 };
  const requests = companies?.filter((c) => c.subscription.requestedPlan).length ?? 0;
  const paying = companies?.filter((c) => c.state.active && c.subscription.plan !== "trial") ?? [];
  const monthly = paying.reduce((sum, c) => sum + plans[c.subscription.plan].priceMad, 0);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (companies ?? []).filter((c) => matches(c, filter) && (!q || [c.name, c.ownerName, c.ownerEmail].some((v) => v?.toLowerCase().includes(q))));
  }, [companies, filter, query]);
  const when = (iso: string | null) => (iso ? date(iso, { day: "numeric", month: "short", year: "numeric" }) : t("jamais"));

  return (
    <div className="platform-page">
      <div className="page-heading">
        <span className="page-symbol"><Building2 size={20} /></span>
        <div className="heading-line">
          <h1>{t("Plateforme")}</h1>
          <button type="button" className="btn" onClick={() => void load()}><RefreshCw size={14} />{t("Actualiser")}</button>
        </div>
        <p>{t("Les entreprises inscrites sur The One Space : leur plan, leur usage, et les paiements reçus.")}</p>
      </div>
      <div className="platform-summary">
        <Surface asChild tone="default"><div><span>{t("Entreprises")}</span><strong>{companies?.length ?? "—"}</strong></div></Surface>
        <Surface asChild tone="default"><div><span>{t("En essai")}</span><strong>{companies?.filter((c) => c.state.phase === "trial").length ?? "—"}</strong></div></Surface>
        <Surface asChild tone="default"><div><span>{t("Payantes")}</span><strong>{paying.length}</strong></div></Surface>
        <Surface asChild tone="default"><div><span>{t("Revenu mensuel")}</span><strong>{monthly} <small>MAD</small></strong></div></Surface>
        <Surface asChild tone="default"><div className={requests ? "attention" : ""}><span>{t("Demandes de plan")}</span><strong>{requests}</strong></div></Surface>
      </div>

      <div className="platform-tools">
        <label className="platform-search"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Rechercher une entreprise, un nom, un e-mail…")} aria-label={t("Rechercher")} /></label>
        <div className="platform-filters" role="radiogroup" aria-label={t("Filtrer")}>
          {filters.map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={filter === id} className={filter === id ? "on" : ""} onClick={() => setFilter(id)}>
              {t(label)} <small>{(companies ?? []).filter((c) => matches(c, id)).length}</small>
            </button>
          ))}
        </div>
      </div>

      {!companies ? <div className="loading"><Loader2 className="spin" /></div>
        : !companies.length ? <p className="platform-empty">{t("Aucune entreprise inscrite pour l’instant.")}</p>
        : !shown.length ? <p className="platform-empty">{t("Aucune entreprise ne correspond.")}</p>
        : (
          <div className="platform-list">
            {shown.map((c) => {
              const ch = choice(c);
              const isOpen = open === c.id;
              const d = isOpen && details?.id === c.id ? details : null;
              return (
                <Surface asChild tone="default" key={c.id}><article className={`platform-row${c.subscription.requestedPlan ? " requested" : ""}`}>
                  <header>
                    <div>
                      <strong>{c.name}</strong>
                      <small>{c.ownerName} · {c.ownerEmail} · {t("inscrite le {day}", { day: date(c.createdAt, { day: "numeric", month: "short", year: "numeric" }) })}</small>
                    </div>
                    <span className={`plan-phase ${c.state.active ? "" : "off"} ${c.state.phase}`}>{c.subscription.plan !== "trial" && `${t(plans[c.subscription.plan].name)} · `}{t(phaseLabels[c.state.phase])}{c.state.endsAt ? ` · ${date(c.state.endsAt, { day: "numeric", month: "short" })}` : ""}</span>
                  </header>
                  <div className="platform-usage">
                    <span>{t("Membres")} <b>{c.usage.members}/{c.state.limits.members}</b></span>
                    <span>{t("Clients")} <b>{c.usage.clients}/{c.state.limits.clients}</b></span>
                    <span>{t("Fichiers")} <b>{storageLabel(c.usage.storageMb, t)}</b></span>
                    <span>{t("IA ce mois-ci")} <b>{c.usage.aiThisMonth}</b></span>
                  </div>
                  {c.subscription.requestedPlan && (
                    <p className="platform-request">{t("A demandé le plan {name}", { name: t(plans[c.subscription.requestedPlan].name) })}{c.subscription.requestedAt ? ` · ${date(c.subscription.requestedAt, { day: "numeric", month: "short" })}` : ""}
                      <button type="button" className="btn ghost" disabled={busy === c.id} onClick={() => void act(c, { action: "dismiss-request" }, "Demande écartée.")}>{t("Écarter")}</button>
                    </p>
                  )}
                  <footer>
                    <label className="platform-pay">
                      <select value={ch.plan} onChange={(e) => setPick({ ...pick, [c.id]: { ...ch, plan: e.target.value as PaidPlanId } })} aria-label={t("Plan")}>
                        {paidPlanIds.map((id) => <option key={id} value={id}>{t(plans[id].name)} · {plans[id].priceMad} MAD</option>)}
                      </select>
                      <select value={ch.months} onChange={(e) => setPick({ ...pick, [c.id]: { ...ch, months: Number(e.target.value) } })} aria-label={t("Durée")}>
                        {[1, 3, 6, 12].map((m) => <option key={m} value={m}>{m === 1 ? t("1 mois") : t("{n} mois", { n: m })}</option>)}
                      </select>
                      <button type="button" className="btn primary" disabled={busy === c.id} onClick={() => void act(c, { action: "mark-paid", plan: ch.plan, months: ch.months }, "Paiement enregistré.")}>
                        {busy === c.id ? <Loader2 size={14} className="spin" /> : null}{t("Paiement reçu")}
                      </button>
                    </label>
                    <div className="inline">
                      <button type="button" className="btn ghost" disabled={busy === c.id} onClick={() => void act(c, { action: "extend-trial", days: 7 }, "Essai prolongé.")}>{t("+7 jours d’essai")}</button>
                      {c.subscription.canceled
                        ? <button type="button" className="btn ghost" disabled={busy === c.id} onClick={() => void act(c, { action: "reactivate" }, "Espace réactivé.")}>{t("Réactiver")}</button>
                        : <button type="button" className="btn ghost danger-text" disabled={busy === c.id} onClick={() => { if (window.confirm(t("Suspendre cet espace ? Il passe en lecture seule."))) void act(c, { action: "suspend" }, "Espace suspendu."); }}>{t("Suspendre")}</button>}
                      <button type="button" className={`btn ghost platform-more${isOpen ? " open" : ""}`} aria-expanded={isOpen} onClick={() => void openDetails(c.id)}>{t("Équipe et aide")}<ChevronDown size={14} /></button>
                    </div>
                  </footer>

                  {isOpen && (
                    <section className="platform-details" aria-label={t("Équipe et aide")}>
                      {!d ? <Loader2 size={16} className="spin" /> : (
                        <>
                          <table className="platform-members">
                            <thead><tr><th>{t("Membre")}</th><th>{t("Rôle")}</th><th>{t("Dernière connexion")}</th><th>{t("Depuis")}</th></tr></thead>
                            <tbody>
                              {d.members.map((m) => (
                                <tr key={m.userId} className={m.support ? "support" : ""}>
                                  <td><b>{m.name || "—"}</b><small>{m.email}</small></td>
                                  <td>{isWorkspaceRole(m.role) ? t(roleLabels[m.role]) : m.role}{m.pending && <span className="platform-chip">{t("Invitation en attente")}</span>}{m.support && <span className="platform-chip gold">{t("Vous")}</span>}</td>
                                  <td>{when(m.lastLoginAt)}</td>
                                  <td>{when(m.joinedAt)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>

                          <div className="platform-help">
                            <div>
                              <h4><LifeBuoy size={15} />{t("Aider cette entreprise")}</h4>
                              <p>{t("Envoyez au propriétaire un lien pour choisir un nouveau mot de passe, ou rejoignez l’espace en observateur pour voir ce qu’il voit. Votre accès apparaît dans son équipe ; il peut le retirer à tout moment.")}</p>
                              <div className="inline">
                                <button type="button" className="btn" disabled={busy === c.id} onClick={() => void act(c, { action: "reset-owner" }, "Lien de réinitialisation envoyé à {email}.")}><KeyRound size={14} />{t("Lien de mot de passe au propriétaire")}</button>
                                {d.supportAccess
                                  ? <button type="button" className="btn" disabled={busy === c.id} onClick={() => void act(c, { action: "support-off" }, "Accès support retiré.")}><LogOut size={14} />{t("Quitter l’espace")}</button>
                                  : <button type="button" className="btn" disabled={busy === c.id} onClick={() => void act(c, { action: "support-on" }, "Accès support ajouté : ouvrez l’espace depuis le sélecteur d’espaces.")}><LifeBuoy size={14} />{t("Rejoindre en observateur")}</button>}
                              </div>
                              {resetLink && <small className="platform-devlink">{t("Mode développement : le lien n’est pas envoyé par e-mail.")} <a href={resetLink}>{resetLink}</a></small>}
                            </div>
                            <div className="platform-danger">
                              <h4><Trash2 size={15} />{t("Supprimer l’entreprise")}</h4>
                              <p>{t("Supprime pour toujours son espace, ses clients, tâches, fichiers, factures et publications, et les comptes qui n’appartiennent qu’à elle. Impossible à annuler.")}</p>
                              <label className="platform-confirm">
                                <span>{t("Tapez « {name} » pour confirmer", { name: c.name })}</span>
                                <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={c.name} autoComplete="off" />
                              </label>
                              <button type="button" className="btn danger" disabled={busy === c.id || confirm.trim() !== c.name.trim()} onClick={() => void act(c, { action: "delete", confirm }, "Entreprise supprimée.")}><Trash2 size={14} />{t("Supprimer définitivement")}</button>
                            </div>
                          </div>
                        </>
                      )}
                    </section>
                  )}
                </article></Surface>
              );
            })}
          </div>
        )}
    </div>
  );
}
