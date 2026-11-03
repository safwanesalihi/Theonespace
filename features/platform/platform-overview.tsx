"use client";
// Plateforme → Vue d'ensemble: the business at a glance (lib/platform-metrics.ts) — monthly revenue, what our
// paid services cost this month and the margin left, the plans in use, sign-ups over eight weeks, and the
// companies that need the owner (a plan asked for, a payment late, a trial ending, a cost too high).
import { Surface } from "@/components/ui/surface";
import { AlertTriangle, ArrowRight, BadgeDollarSign, Clock, Hourglass, Loader2, TrendingUp, Users, Wallet } from "lucide-react";
import { useI18n } from "@/lib/i18n/locale-provider";
import { plans } from "@/lib/plans";
import PlatformHealth from "./platform-health";
import { platformOverview, serviceCost, type Attention } from "@/lib/platform-metrics";
import type { Company, ErrorEntry } from "./platform-types";

const mad = (n: number) => Math.round(n).toLocaleString("fr-FR");
const attentionText: Record<Attention["kind"], string> = {
  request: "a demandé un plan payant",
  grace: "paiement attendu · {days} j de grâce",
  "trial-ending": "fin de l’essai dans {days} j",
  cost: "coûte {amount} MAD ce mois-ci",
};
const attentionIcon = { request: BadgeDollarSign, grace: Wallet, "trial-ending": Hourglass, cost: AlertTriangle };

export default function PlatformOverview({ companies, errors, onOpen }: { companies: Company[] | null; errors: ErrorEntry[] | null; onOpen: (name: string) => void }) {
  const { t, date } = useI18n();
  if (!companies) return <div className="loading"><Loader2 className="spin" /></div>;
  const o = platformOverview(companies);
  const maxSignups = Math.max(1, ...o.signups.map((s) => s.count));
  const active = o.planMix.trial + o.planMix.starter + o.planMix.pro + o.planMix.agency;
  const mix = (["agency", "pro", "starter", "trial"] as const).map((id) => ({ id, n: o.planMix[id] }));
  const costs = companies.map((c) => serviceCost(c.usage)).reduce((sum, c) => ({ whatsapp: sum.whatsapp + c.whatsapp, calls: sum.calls + c.calls, instagram: sum.instagram + c.instagram, ai: sum.ai + c.ai }), { whatsapp: 0, calls: 0, instagram: 0, ai: 0 });
  const recentErrors = errors?.filter((e) => e.recent).length ?? 0;

  return (
    <div className="pf-overview">
      <div className="pf-kpis">
        <Surface tone="gold" className="pf-kpi lead">
          <span><TrendingUp size={15} />{t("Revenu mensuel")}</span>
          <strong>{mad(o.mrr)}<small> MAD</small></strong>
          <em>{t("{n} MAD sur un an", { n: mad(o.arr) })}</em>
        </Surface>
        <Surface className="pf-kpi">
          <span><Wallet size={15} />{t("Coût des services ce mois-ci")}</span>
          <strong>{mad(o.serviceCost)}<small> MAD</small></strong>
          <em>{t("WhatsApp, appels, Instagram, IA")}</em>
        </Surface>
        <Surface className={`pf-kpi${o.marginRate !== null && o.marginRate < 0.4 ? " warn" : ""}`}>
          <span><BadgeDollarSign size={15} />{t("Marge")}</span>
          <strong>{mad(o.margin)}<small> MAD</small></strong>
          <em>{o.marginRate === null ? t("aucune agence payante") : t("{n} % du revenu", { n: Math.round(o.marginRate * 100) })}</em>
        </Surface>
        <Surface className="pf-kpi">
          <span><Users size={15} />{t("Agences")}</span>
          <strong>{o.companies}</strong>
          <em>{t("{paying} payantes · {trials} en essai · {stopped} arrêtées", { paying: o.paying, trials: o.trials, stopped: o.stopped })}</em>
        </Surface>
      </div>

      <div className="pf-grid">
        <Surface className="pf-card pf-attention">
          <h3><Clock size={15} />{t("À traiter")} <small>{o.attention.length}</small></h3>
          {!o.attention.length ? <p className="pf-quiet">{t("Rien ne vous attend. Tout est en ordre.")}</p> : (
            <ul>
              {o.attention.map((a) => {
                const Icon = attentionIcon[a.kind];
                return (
                  <li key={`${a.kind}:${a.id}`} className={a.kind}>
                    <button type="button" onClick={() => onOpen(a.name)}>
                      <Icon size={15} aria-hidden />
                      <span><b>{a.name}</b> {t(attentionText[a.kind], { days: a.days ?? 0, amount: mad(a.amount ?? 0) })}</span>
                      <ArrowRight size={14} aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Surface>

        <Surface className="pf-card">
          <h3>{t("Plans actifs")} <small>{active}</small></h3>
          <div className="pf-mix" role="img" aria-label={mix.map((m) => `${m.n} ${m.id}`).join(", ")}>
            {mix.filter((m) => m.n).map((m) => <i key={m.id} className={m.id} style={{ flexGrow: m.n }} />)}
          </div>
          <ul className="pf-legend">
            {mix.map((m) => (
              <li key={m.id}><i className={m.id} aria-hidden />{m.id === "trial" ? t("Essai") : t(plans[m.id].name)}<b>{m.n}</b>{m.id !== "trial" && <small>{plans[m.id].priceMad} MAD</small>}</li>
            ))}
          </ul>
        </Surface>

        <Surface className="pf-card">
          <h3>{t("Inscriptions, 8 dernières semaines")}</h3>
          <div className="pf-bars">
            {o.signups.map((s) => (
              <div key={s.week} title={t("{n} le {day}", { n: s.count, day: date(s.week, { day: "numeric", month: "short" }) })}>
                <b style={{ height: `${Math.max(4, (s.count / maxSignups) * 100)}%` }} className={s.count ? "" : "zero"}><span>{s.count || ""}</span></b>
                <small>{date(s.week, { day: "numeric", month: "short" })}</small>
              </div>
            ))}
          </div>
        </Surface>

        <Surface className="pf-card">
          <h3>{t("D’où vient le coût")}</h3>
          <ul className="pf-costs">
            {([["WhatsApp", costs.whatsapp], [t("Appels vidéo"), costs.calls], [t("Analyses Instagram"), costs.instagram], [t("Assistant IA"), costs.ai]] as const).map(([label, value]) => (
              <li key={label}>
                <span>{label}</span>
                <i aria-hidden><b style={{ width: `${o.serviceCost ? (value / o.serviceCost) * 100 : 0}%` }} /></i>
                <strong>{mad(value)} MAD</strong>
              </li>
            ))}
          </ul>
          <p className="pf-quiet">{t("Estimation : WhatsApp ≈ 0,23 MAD le message, un appel ≈ 0,04 MAD la minute, une analyse Instagram ≈ 1,15 MAD.")}</p>
        </Surface>
      </div>

      <PlatformHealth />

      {recentErrors > 0 && (
        <Surface className="pf-card pf-errors-hint">
          <AlertTriangle size={16} />
          <span>{t("{n} erreur(s) de production aujourd’hui : voyez l’onglet Journal.", { n: recentErrors })}</span>
        </Surface>
      )}
    </div>
  );
}
