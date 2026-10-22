"use client";
// « Abonnement » (Équipe page, a company's owner and administrators): the plan, the days left, what is
// used of each limit, and the plans to move to — the owner asks, The One Core is told by e-mail and
// records the payment on its Plateforme page (lib/plans.ts). And the banner every member of a company
// sees when its trial or paid period is ending or over.
import { Surface } from "@/components/ui/surface";
import { useState } from "react";
import { AlertTriangle, Check, CreditCard, Loader2, Lock } from "lucide-react";
import { useI18n } from "@/lib/i18n/locale-provider";
import { inactiveMessage, paidPlanIds, plans, type PaidPlanId, type PlanLimits, type Subscription, type SubscriptionState, type Usage } from "@/lib/plans";

export type PlanPayload = { state: SubscriptionState; subscription?: Subscription; usage?: Usage };

const phaseLabels: Record<SubscriptionState["phase"], string> = {
  trial: "Essai gratuit", paid: "Actif", grace: "Paiement attendu", "trial-ended": "Essai terminé", expired: "Expiré", canceled: "Suspendu",
};

export const storageLabel = (mb: number, t: (text: string) => string = (text) => text) =>
  (mb >= 1024 ? `${Math.round((mb / 1024) * 10) / 10} ${t("Go")}` : `${Math.round(mb)} ${t("Mo")}`);

function Meter({ label, used, max, format = String }: { label: string; used: number; max: number; format?: (n: number) => string }) {
  const ratio = Math.min(1, max ? used / max : 0);
  return (
    <div className={`plan-meter${ratio >= 1 ? " full" : ratio >= 0.8 ? " near" : ""}`}>
      <div><span>{label}</span><strong>{format(used)} / {format(max)}</strong></div>
      <i><b style={{ width: `${Math.round(ratio * 100)}%` }} /></i>
    </div>
  );
}

function LimitList({ limits }: { limits: PlanLimits }) {
  const { t } = useI18n();
  return (
    <ul>
      <li>{t("{n} membres de l’équipe", { n: limits.members })}</li>
      <li>{t("{n} clients", { n: limits.clients })}</li>
      <li>{t("{size} de fichiers", { size: storageLabel(limits.storageMb, t) })}</li>
      <li>{t("{n} demandes à l’IA par mois", { n: limits.aiPerMonth })}</li>
    </ul>
  );
}

export default function SubscriptionPanel({ plan, owner, onRequest, onNotice, onError }: {
  plan: PlanPayload;
  owner: boolean;
  onRequest: (plan: PaidPlanId) => Promise<{ planRequest?: { sent: boolean } } | unknown>;
  onNotice: (text: string) => void;
  onError: (text: string) => void;
}) {
  const { t, date } = useI18n();
  const [busy, setBusy] = useState<PaidPlanId | null>(null);
  const { state, subscription, usage } = plan;
  if (!subscription || !usage) return null;
  const current = plans[state.plan];

  async function ask(id: PaidPlanId) {
    setBusy(id);
    try {
      await onRequest(id);
      onNotice(t("Demande envoyée : l’équipe The One Space vous contacte pour le paiement."));
    } catch (e) { onError(t((e as Error).message)); }
    setBusy(null);
  }

  const status = state.phase === "trial" ? t("{n} jours restants", { n: state.daysLeft ?? 0 })
    : state.phase === "paid" ? t("Payé jusqu’au {day}", { day: date(state.endsAt ?? undefined, { day: "numeric", month: "long", year: "numeric" }) })
    : state.phase === "grace" ? t("Encore {n} jours pour régler", { n: state.daysLeft ?? 0 })
    : t(inactiveMessage(state.phase));

  return (
    <Surface asChild tone="default"><section className="work-panel plan-panel" aria-labelledby="plan-title">
      <header className="plan-head">
        <div>
          <h2 id="plan-title"><CreditCard size={16} />{t("Abonnement")}</h2>
          <p>{state.plan !== "trial" && <>{t("Plan {name}", { name: t(current.name) })} · </>}<span className={`plan-phase ${state.active ? "" : "off"} ${state.phase}`}>{t(phaseLabels[state.phase])}</span> · {status}</p>
        </div>
      </header>
      <div className="plan-meters">
        <Meter label={t("Membres de l’équipe")} used={usage.members} max={state.limits.members} />
        <Meter label={t("Clients")} used={usage.clients} max={state.limits.clients} />
        <Meter label={t("Fichiers")} used={usage.storageMb} max={state.limits.storageMb} format={(n) => storageLabel(n, t)} />
        <Meter label={t("IA ce mois-ci")} used={usage.aiThisMonth} max={state.limits.aiPerMonth} />
      </div>
      <div className="plan-cards">
        {paidPlanIds.map((id) => {
          const p = plans[id];
          const isCurrent = state.plan === id && state.active;
          const requested = subscription.requestedPlan === id;
          return (
            <Surface asChild tone={isCurrent ? "gold" : "default"} key={id}><article className={`plan-card${isCurrent ? " current" : ""}`}>
              <header><strong>{t(p.name)}</strong><span><b>{p.priceMad}</b> {t("MAD / mois")}</span></header>
              <LimitList limits={p.limits} />
              {isCurrent ? <span className="plan-card-note"><Check size={14} />{t("Votre plan")}</span>
                : requested ? <span className="plan-card-note"><Check size={14} />{t("Demandé : nous vous contactons")}</span>
                : owner ? (
                  <button type="button" className="btn primary" disabled={!!busy} onClick={() => void ask(id)}>
                    {busy === id ? <Loader2 size={14} className="spin" /> : null}{t(state.plan === id ? "Renouveler" : "Choisir ce plan")}
                  </button>
                ) : null}
            </article></Surface>
          );
        })}
      </div>
      <small className="plan-foot">{owner
        ? t("Après votre demande, l’équipe The One Space vous contacte pour le paiement (virement ou carte), puis active le plan.")
        : t("Seul le propriétaire de l’espace peut changer de plan.")}</small>
    </section></Surface>
  );
}

/** Shown above every page of a company whose trial ends within 3 days, is in its grace days, or has stopped. */
export function PlanBanner({ plan, manager, onOpen }: { plan: PlanPayload | null; manager: boolean; onOpen: () => void }) {
  const { t } = useI18n();
  if (!plan) return null;
  const { state } = plan;
  const soon = (state.phase === "trial" && (state.daysLeft ?? 99) <= 3) || state.phase === "grace";
  if (state.active && !soon) return null;
  const text = !state.active ? t(inactiveMessage(state.phase))
    : state.phase === "grace" ? t("Votre période payée est terminée : réglez sous {n} jours pour garder l’accès.", { n: state.daysLeft ?? 0 })
    : t("Votre essai se termine dans {n} jours.", { n: state.daysLeft ?? 0 });
  return (
    <div className={`plan-banner${state.active ? "" : " off"}`} role="status">
      {state.active ? <AlertTriangle size={16} /> : <Lock size={16} />}
      <span>{text}{!state.active && ` ${t("Vous pouvez toujours consulter et exporter vos données.")}`}</span>
      {manager && <button type="button" className="btn" onClick={onOpen}>{t("Voir les plans")}</button>}
    </div>
  );
}
