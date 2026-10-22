"use client";
// The six numbers of The One Flow (lib/flow.ts computeMetrics), under the dashboard's stage: each with
// its target, whether the period meets it, and what it is counted on. They are what an agency owner
// promises clients and watches; « — » until the period has something to count.
import { CheckCircle2, CircleAlert } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { computeMetrics, flow, type Period } from "@/lib/flow";
import { useI18n } from "@/lib/i18n/locale-provider";
import type { RecordItem } from "@/lib/model";

type Card = { key: string; label: string; value: string; target: string; basis: string; state: "ok" | "watch" | "none" };

export default function FlowScorecards({ records, period }: { records: RecordItem[]; period: Period }) {
  const { t, tag } = useI18n();
  const m = computeMetrics(records, period);
  const goal = flow.targets;
  // A no-break space, so « 30 % » never splits across two lines.
  const pct = (v: number) => `${Math.round(v * 100)} %`;
  const num = (v: number, digits = 1) => v.toLocaleString(tag, { maximumFractionDigits: digits });
  const state = (value: number | null, ok: (v: number) => boolean): Card["state"] => (value === null ? "none" : ok(value) ? "ok" : "watch");
  const cards: Card[] = [
    { key: "on-time", label: "Publié à l’heure", value: m.onTimeRate === null ? "—" : pct(m.onTimeRate), target: t("Objectif ≥ {v}", { v: pct(goal.onTimeRate) }),
      basis: t("{n} sur {total} publiés", { n: m.onTime, total: m.published }), state: state(m.onTimeRate, (v) => v >= goal.onTimeRate) },
    { key: "validation", label: "Délai de validation", value: m.medianValidationHours === null ? "—" : `${num(m.medianValidationHours)} h`, target: t("Objectif < {v} h", { v: goal.medianValidationHours }),
      basis: t("Médiane de {n} décisions", { n: m.explicitDecisions }), state: state(m.medianValidationHours, (v) => v < goal.medianValidationHours) },
    { key: "silence", label: "Validé par silence", value: m.silenceShare === null ? "—" : pct(m.silenceShare), target: t("À surveiller au-delà de {v}", { v: pct(goal.silenceShare) }),
      basis: t("{n} sur {total} validations", { n: m.silent, total: m.validated }), state: state(m.silenceShare, (v) => v <= goal.silenceShare) },
    { key: "rounds", label: "Tours de retouches", value: m.roundsPerItem === null ? "—" : num(m.roundsPerItem), target: t("Objectif ≤ {v} par contenu", { v: num(goal.roundsPerItem) }),
      basis: t("Moyenne sur {n} contenus validés", { n: m.validated }), state: state(m.roundsPerItem, (v) => v <= goal.roundsPerItem) },
    { key: "sold", label: "Livré / vendu", value: m.deliveredVsSold === null ? "—" : pct(m.deliveredVsSold), target: t("Objectif {from}–{to}", { from: pct(goal.deliveredVsSold[0]), to: pct(goal.deliveredVsSold[1]) }),
      basis: t("{n} publiés pour {total} vendus", { n: m.delivered, total: m.sold }), state: state(m.deliveredVsSold, (v) => v >= goal.deliveredVsSold[0] && v <= goal.deliveredVsSold[1]) },
    { key: "evergreen", label: "Réserve evergreen", value: m.evergreenPerClient === null ? "—" : num(m.evergreenPerClient), target: t("Objectif ≥ {v} par client", { v: goal.evergreen }),
      basis: t("Moyenne sur {n} clients", { n: m.clients.length }), state: state(m.evergreenPerClient, (v) => v >= goal.evergreen) },
  ];
  return (
    <section className="flow-scores" aria-labelledby="flow-scores-title">
      <h2 id="flow-scores-title">{t("Les six chiffres du flux")}</h2>
      <div className="flow-scores-grid">
        {cards.map((card) => (
          <Surface asChild tone="default" key={card.key}><article className={`flow-score ${card.state}`}>
            <header>
              <span>{t(card.label)}</span>
              {card.state === "ok" ? <CheckCircle2 size={15} aria-label={t("Objectif atteint")} /> : card.state === "watch" ? <CircleAlert size={15} aria-label={t("À surveiller")} /> : null}
            </header>
            <strong><bdi dir="ltr">{card.value}</bdi></strong>
            <small>{card.target}</small>
            <small className="flow-score-basis">{card.state === "none" ? t("Pas encore de données sur la période") : card.basis}</small>
          </article></Surface>
        ))}
      </div>
    </section>
  );
}
