"use client";
// « Abonnement » (Équipe page, a company's owner and administrators): the plan, the days left, what is
// used of each limit, and the plans to move to — the owner asks, The One Core is told by e-mail and
// records the payment on its Plateforme page (lib/plans.ts). And the banner every member of a company
// sees when its trial or paid period is ending or over.
import { Surface } from "@/components/ui/surface";
import { useState } from "react";
import { AlertTriangle, Check, CreditCard, Download, Loader2, Lock } from "lucide-react";
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
      <li>{t("{n} analyses Instagram par mois", { n: limits.igPerMonth })}</li>
      <li>{t("{n} minutes de réunion par mois", { n: limits.meetingMinutesPerMonth })}</li>
      <li>{t("{n} messages WhatsApp par mois", { n: limits.whatsappPerMonth })}</li>
    </ul>
  );
}

export default function SubscriptionPanel({ plan, owner, workspaceId, onRequest, onNotice, onError }: {
  plan: PlanPayload;
  owner: boolean;
  /** For the owner's « Exporter les données » (app/api/workspace-export). */
  workspaceId: string;
  onRequest: (plan: PaidPlanId) => Promise<{ planRequest?: { sent: boolean } } | unknown>;
  onNotice: (text: string) => void;
  onError: (text: string) => void;
}) {
  const { t, date } = useI18n();
  const [busy, setBusy] = useState<PaidPlanId | null>(null);
  const [exporting, setExporting] = useState(false);
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

  // The agency's data in one file, whatever the plan's state (lib/workspace-export.ts).
  async function exportData() {
    setExporting(true);
    try {
      const res = await fetch("/api/workspace-export", { headers: { "X-Workspace-Id": workspaceId } });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error || "L’export a échoué.");
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "the-one-space.json";
      const url = URL.createObjectURL(await res.blob());
      const link = Object.assign(document.createElement("a"), { href: url, download: name });
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      onNotice(t("Données exportées"));
    } catch (e) { onError(t((e as Error).message)); }
    setExporting(false);
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
        {/* The agency keeps its data whatever happens: one file, said plainly under the button. */}
        {owner && <div className="plan-export">
          <button type="button" className={`btn plan-export-btn${exporting ? " is-busy" : ""}`} disabled={exporting} onClick={() => void exportData()} aria-describedby="plan-export-note">
            <span className="plan-export-mark" aria-hidden="true">{exporting ? <Loader2 size={14} className="spin" /> : <Download size={14} />}</span>{t("Exporter les données")}
          </button>
          <small id="plan-export-note">{t("Toutes les données de l’espace dans un fichier : clients, tâches, publications, documents, réglages, équipe.")}</small>
        </div>}
      </header>
      <div className="plan-meters">
        <Meter label={t("Membres de l’équipe")} used={usage.members} max={state.limits.members} />
        <Meter label={t("Clients")} used={usage.clients} max={state.limits.clients} />
        <Meter label={t("Fichiers")} used={usage.storageMb} max={state.limits.storageMb} format={(n) => storageLabel(n, t)} />
        <Meter label={t("IA ce mois-ci")} used={usage.aiThisMonth} max={state.limits.aiPerMonth} />
        <Meter label={t("Analyses Instagram ce mois-ci")} used={usage.igThisMonth} max={state.limits.igPerMonth} />
        <Meter label={t("Minutes de réunion ce mois-ci")} used={usage.meetingMinutesThisMonth} max={state.limits.meetingMinutesPerMonth} />
        <Meter label={t("WhatsApp ce mois-ci")} used={usage.whatsappThisMonth} max={state.limits.whatsappPerMonth} />
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
                  <button type="button" className="btn solid" disabled={!!busy} onClick={() => void ask(id)}>
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
