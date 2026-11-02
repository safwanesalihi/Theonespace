"use client";
// Plateforme → Agences: every company that signed up — its plan, its usage, what that use costs us this
// month, any plan it asked for and its team — with the buttons to record a payment, extend a trial,
// suspend, help (owner password-reset link, read-only support access) or delete it for good.
import { Surface } from "@/components/ui/surface";
import { useMemo, useState } from "react";
import { ChevronDown, KeyRound, LifeBuoy, Loader2, LogOut, Search, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/locale-provider";
import { storageLabel } from "@/features/plans/subscription-panel";
import { paidPlanIds, plans, type PaidPlanId } from "@/lib/plans";
import { costLevel, monthlyRevenue, serviceCost } from "@/lib/platform-metrics";
import { roleLabels, isWorkspaceRole } from "@/lib/workspace";
import { phaseLabels, type Company } from "./platform-types";

type Member = { userId: string; name: string | null; email: string | null; role: string; joinedAt: string; lastLoginAt: string | null; pending: boolean; support: boolean };
type Details = { id: string; name: string; members: Member[]; supportAccess: boolean };
type Filter = "all" | "trial" | "paying" | "stopped" | "requests" | "cost";

const filters: [Filter, string][] = [["all", "Toutes"], ["trial", "En essai"], ["paying", "Payantes"], ["stopped", "Arrêtées"], ["requests", "Demandes"], ["cost", "Coût élevé"]];
const matches = (c: Company, f: Filter) =>
  f === "all" ? true
  : f === "trial" ? c.state.phase === "trial"
  : f === "paying" ? monthlyRevenue(c) > 0
  : f === "stopped" ? !c.state.active
  : f === "requests" ? !!c.subscription.requestedPlan
  : costLevel(c) !== "ok";
// What needs the owner first: a plan asked for, a late payment, a cost out of line; stopped companies last.
const urgency = (c: Company) =>
  c.subscription.requestedPlan ? 0 : c.state.phase === "grace" ? 1 : costLevel(c) === "high" ? 2 : !c.state.active ? 4 : 3;
const mad = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} MAD`;

export default function PlatformAgencies({ companies, initialQuery, onCompanies, onNotice, onError }: {
  companies: Company[] | null; initialQuery: string; onCompanies: (list: Company[]) => void;
  onNotice: (text: string) => void; onError: (text: string) => void;
}) {
  const { t, date } = useI18n();
  const [busy, setBusy] = useState("");
  const [pick, setPick] = useState<Record<string, { plan: PaidPlanId; months: number }>>({});
  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [confirm, setConfirm] = useState("");
  const [resetLink, setResetLink] = useState("");
  const [suspending, setSuspending] = useState<string | null>(null);

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
      if (data.companies) onCompanies(data.companies);
      if (data.details) setDetails(data.details);
      if (data.reset?.devLink) setResetLink(data.reset.devLink);
      if (data.deleted) { setOpen(null); setDetails(null); }
      onNotice(t(notice, data.reset ? { email: data.reset.email } : undefined));
    } catch (e) { onError(t((e as Error).message)); }
    setBusy(""); setSuspending(null);
  }

  const choice = (c: Company) => pick[c.id] ?? { plan: c.subscription.requestedPlan ?? (c.subscription.plan === "trial" ? "starter" : c.subscription.plan as PaidPlanId), months: 1 };
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (companies ?? []).filter((c) => matches(c, filter) && (!q || [c.name, c.ownerName, c.ownerEmail].some((v) => v?.toLowerCase().includes(q))))
      .sort((a, b) => urgency(a) - urgency(b) || monthlyRevenue(b) - monthlyRevenue(a));
  }, [companies, filter, query]);
  const when = (iso: string | null) => (iso ? date(iso, { day: "numeric", month: "short", year: "numeric" }) : t("jamais"));

  return (
    <div className="pf-agencies">
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
              const cost = serviceCost(c.usage);
              const level = costLevel(c);
              const revenue = monthlyRevenue(c);
              return (
                <Surface asChild tone="default" key={c.id}><article className={`platform-row${c.subscription.requestedPlan ? " requested" : ""}`}>
                  <header>
                    <div className="pf-agency-id">
                      <span className="pf-avatar" aria-hidden>{c.name.slice(0, 2).toUpperCase()}</span>
                      <div>
                        <strong>{c.name}</strong>
                        <small>{c.ownerName} · {c.ownerEmail} · {t("inscrite le {day}", { day: date(c.createdAt, { day: "numeric", month: "short", year: "numeric" }) })}</small>
                      </div>
                    </div>
                    <span className={`pf-phase ${c.state.phase}`}>{c.subscription.plan !== "trial" && `${t(plans[c.subscription.plan].name)} · `}{t(phaseLabels[c.state.phase])}{c.state.endsAt ? ` · ${date(c.state.endsAt, { day: "numeric", month: "short" })}` : ""}</span>
                  </header>
                  <div className="pf-agency-body">
                    <dl className="pf-meters">
                      <Meter label={t("Membres")} used={c.usage.members} max={c.state.limits.members} />
                      <Meter label={t("Clients")} used={c.usage.clients} max={c.state.limits.clients} />
                      <Meter label={t("WhatsApp ce mois-ci")} used={c.usage.whatsappThisMonth} max={c.state.limits.whatsappPerMonth} />
                      <Meter label={t("Minutes de réunion ce mois-ci")} used={c.usage.meetingMinutesThisMonth} max={c.state.limits.meetingMinutesPerMonth} />
                      <Meter label={t("Analyses Instagram ce mois-ci")} used={c.usage.igThisMonth} max={c.state.limits.igPerMonth} />
                      <div className="pf-meter plain"><dt>{t("Fichiers")}</dt><dd>{storageLabel(c.usage.storageMb, t)}</dd></div>
                    </dl>
                    <div className={`pf-cost ${level}`}>
                      <span>{t("Coût estimé ce mois-ci")}</span>
                      <strong>{mad(cost.total)}</strong>
                      <small>{revenue ? t("pour {price} payés", { price: mad(revenue) }) : t("pendant l’essai")}</small>
                      <small className="pf-cost-split">WhatsApp {mad(cost.whatsapp)} · {t("Appels")} {mad(cost.calls)} · Instagram {mad(cost.instagram)}</small>
                    </div>
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
                        : suspending === c.id
                          ? <span className="pf-confirm-inline">{t("Lecture seule pour toute l’équipe ?")}
                              <button type="button" className="btn danger" disabled={busy === c.id} onClick={() => void act(c, { action: "suspend" }, "Espace suspendu.")}>{t("Suspendre")}</button>
                              <button type="button" className="btn ghost" onClick={() => setSuspending(null)}>{t("Annuler")}</button>
                            </span>
                          : <button type="button" className="btn ghost danger-text" disabled={busy === c.id} onClick={() => setSuspending(c.id)}>{t("Suspendre")}</button>}
                      <button type="button" className={`btn ghost platform-more${isOpen ? " open" : ""}`} aria-expanded={isOpen} onClick={() => void openDetails(c.id)}>{t("Équipe et aide")}<ChevronDown size={14} /></button>
                    </div>
                  </footer>

                  {isOpen && (
                    <section className="platform-details" aria-label={t("Équipe et aide")}>
                      {!d ? <Loader2 size={16} className="spin" /> : (
                        <>
                          <div className="pf-table-scroll"><table className="platform-members">
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
                          </table></div>

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

/** One plan limit: used against allowed, with a bar that warns from 80 % and turns red when full. */
function Meter({ label, used, max }: { label: string; used: number; max: number }) {
  const share = max ? Math.min(1, used / max) : 0;
  return (
    <div className={`pf-meter${share >= 1 ? " full" : share >= 0.8 ? " near" : ""}`}>
      <dt>{label}</dt>
      <dd>{used.toLocaleString("fr-FR")}<small>/{max.toLocaleString("fr-FR")}</small></dd>
      <i aria-hidden><b style={{ width: `${Math.round(share * 100)}%` }} /></i>
    </div>
  );
}
