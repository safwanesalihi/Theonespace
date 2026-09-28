"use client";
// « Plateforme » (The One Core's owner only, /api/platform): every company that signed up, its plan,
// its usage and any plan it asked for — and the buttons to record a payment, extend a trial or suspend.
import { useCallback, useEffect, useState } from "react";
import { Building2, Loader2, RefreshCw } from "lucide-react";
import { useI18n } from "@/app/locale-provider";
import { storageLabel } from "@/app/subscription-panel";
import { paidPlanIds, plans, type PaidPlanId, type Subscription, type SubscriptionState, type Usage } from "@/lib/plans";

type Company = { id: string; name: string; createdAt: string; ownerEmail: string | null; ownerName: string | null; subscription: Subscription; state: SubscriptionState; usage: Usage };

const phaseLabels: Record<SubscriptionState["phase"], string> = {
  trial: "Essai gratuit", paid: "Actif", grace: "Paiement attendu", "trial-ended": "Essai terminé", expired: "Expiré", canceled: "Suspendu",
};

export default function PlatformPage({ onNotice, onError }: { onNotice: (text: string) => void; onError: (text: string) => void }) {
  const { t, date } = useI18n();
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [busy, setBusy] = useState("");
  const [pick, setPick] = useState<Record<string, { plan: PaidPlanId; months: number }>>({});

  const load = useCallback(async () => {
    const r = await fetch("/api/platform", { cache: "no-store" });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { onError(t(data.error || "Chargement impossible.")); return; }
    setCompanies(data.companies);
  }, [onError, t]);
  useEffect(() => { void load(); }, [load]);

  async function act(company: Company, body: Record<string, unknown>, notice: string) {
    setBusy(company.id);
    try {
      const r = await fetch("/api/platform", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId: company.id, ...body }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Action impossible.");
      setCompanies(data.companies);
      onNotice(t(notice));
    } catch (e) { onError(t((e as Error).message)); }
    setBusy("");
  }

  const choice = (c: Company) => pick[c.id] ?? { plan: c.subscription.requestedPlan ?? (c.subscription.plan === "trial" ? "starter" : c.subscription.plan as PaidPlanId), months: 1 };
  const requests = companies?.filter((c) => c.subscription.requestedPlan).length ?? 0;
  const paying = companies?.filter((c) => c.state.active && c.subscription.plan !== "trial") ?? [];
  const monthly = paying.reduce((sum, c) => sum + plans[c.subscription.plan].priceMad, 0);

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
        <div><span>{t("Entreprises")}</span><strong>{companies?.length ?? "—"}</strong></div>
        <div><span>{t("En essai")}</span><strong>{companies?.filter((c) => c.state.phase === "trial").length ?? "—"}</strong></div>
        <div><span>{t("Payantes")}</span><strong>{paying.length}</strong></div>
        <div><span>{t("Revenu mensuel")}</span><strong>{monthly} <small>MAD</small></strong></div>
        <div className={requests ? "attention" : ""}><span>{t("Demandes de plan")}</span><strong>{requests}</strong></div>
      </div>
      {!companies ? <div className="loading"><Loader2 className="spin" /></div>
        : !companies.length ? <p className="platform-empty">{t("Aucune entreprise inscrite pour l’instant.")}</p>
        : (
          <div className="platform-list">
            {companies.map((c) => {
              const ch = choice(c);
              return (
                <article key={c.id} className={`platform-row${c.subscription.requestedPlan ? " requested" : ""}`}>
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
                    </div>
                  </footer>
                </article>
              );
            })}
          </div>
        )}
    </div>
  );
}
