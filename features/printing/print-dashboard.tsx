"use client";
// The print workspace dashboard: income, expenses and balance of the period, orders in production,
// what remains to be paid, six months of cash flow and the latest movements.
import { Surface } from "@/components/ui/surface";
import { printOrderStatuses, printOrderLabels } from "@/lib/printing";
import { Package } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { PrintContext } from "./use-print-workspace";
import { Stat } from "./print-form";

export function PrintDashboard({ ctx }: { ctx: PrintContext }) {
  const { t, manager, money, orders, totals, activeOrders, outstanding, months } = ctx;
  return (
    <>
      <div className="print-stats">
        {manager ? (
          <>
            <Stat
              label={t("Entrées")}
              value={money(totals.income)}
              hint={t("Encaissements réels")}
              tone="green"
            />
            <Stat
              label={t("Sorties")}
              value={money(totals.expenses)}
              hint={t("Décaissements réels")}
              tone="red"
            />
            <Stat
              label={t("Solde de la période")}
              value={money(totals.balance)}
              hint={t("Entrées moins sorties")}
            />
            <Stat
              label={t("Reste à encaisser")}
              value={money(outstanding)}
              hint={t("Toutes les commandes non annulées")}
            />
          </>
        ) : null}
      </div>
      <div className="print-dashboard-grid">
        {manager && (
          <Surface asChild tone="default"><section className="print-panel">
            <div className="print-panel-title">
              <h2>{t("Mouvements de trésorerie")}</h2>
              <small>{t("6 mois · MAD")}</small>
            </div>
            <div className="print-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={months} barGap={5}>
                  <CartesianGrid
                    vertical={false}
                    strokeDasharray="3 4"
                    stroke="var(--t-line)"
                  />
                  <XAxis
                    dataKey="name"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "var(--t-text-muted)" }}
                  />
                  <YAxis tickLine={false} axisLine={false} width={65} tick={{ fill: "var(--t-text-muted)" }} />
                  <Tooltip formatter={(v) => money(Number(v) * 100)} contentStyle={{ background: "var(--t-surface)", borderColor: "var(--t-line-strong)", color: "var(--t-text)" }} itemStyle={{ color: "var(--t-text-body)" }} />
                  <Legend formatter={(value) => <span style={{ color: "var(--t-text-body)" }}>{value}</span>} />
                  <Bar
                    dataKey="income"
                    name={t("Entrées")}
                    fill="var(--t-chart-done)"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="expenses"
                    name={t("Sorties")}
                    fill="var(--t-danger)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section></Surface>
        )}
        <Surface asChild tone="default"><section className="print-panel">
          <div className="print-panel-title">
            <h2>{t("Production")}</h2>
            <Package size={18} />
          </div>
          <div className="print-production-count">
            <strong>{activeOrders.length}</strong>
            <span>{t("commandes en cours")}</span>
          </div>
          <div className="print-stages">
            {printOrderStatuses.map((status) => (
              <div key={status}>
                <span>{t(printOrderLabels[status])}</span>
                <b>
                  {
                    orders.filter((o) => o.orderStatus === status)
                      .length
                  }
                </b>
              </div>
            ))}
          </div>
        </section></Surface>
      </div>
      <div className="print-dashboard-grid">
      </div>
    </>
  );
}
