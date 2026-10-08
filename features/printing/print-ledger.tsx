"use client";
// The print workspace ledger: cash movements (with an inline entry row and CSV export) and orders
// (status, payments, tasks), searchable and filterable.
import { Surface } from "@/components/ui/surface";
import { orderPayment, printOrderStatuses, printOrderLabels, quantityUnitLabels, type QuantityUnit } from "@/lib/printing";
import { Plus, ArrowDownLeft, ArrowUpRight, Search, Pencil, Download, Trash2 } from "lucide-react";
import type { PrintContext } from "./use-print-workspace";
import { Choice, Stat } from "./print-form";

export function PrintLedger({ ctx }: { ctx: PrintContext }) {
  const { t, tag, date, manager, page, query, setQuery, filter, setFilter, addingTx, setAddingTx, setEditor, inlineTx, setInlineTx, setRemovingPayment, setRemovingOrder, setError, disabled, money, orders, totals, act, movements, shownOrders, exportCsv, empty, progress, p } = ctx;
  return (
    <>
      {page === "transactions" && (
        <div className="print-stats">
          <Stat
            label={t("Entrées")}
            value={money(totals.income)}
            tone="green"
          />
          <Stat
            label={t("Sorties")}
            value={money(totals.expenses)}
            tone="red"
          />
          <Stat
            label={t("Solde de la période")}
            value={money(totals.balance)}
          />
        </div>
      )}
      <Surface asChild tone="default"><section className="print-panel print-list">
        <div className="print-toolbar">
          <label className="print-search">
            <Search size={17} />
            <input
              aria-label={t("Rechercher")}
              placeholder={t("Rechercher…")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <Choice
            label={t("Filtrer par statut")}
            value={filter}
            onChange={setFilter}
            items={[
              { value: "", label: t("Tout") },
              ...(page === "transactions"
                ? [
                    { value: "in", label: t("Entrées") },
                    { value: "out", label: t("Sorties") },
                    { value: "void", label: t("Annulées") },
                  ]
                : page === "orders"
                  ? printOrderStatuses.map((value) => ({
                      value,
                      label: t(printOrderLabels[value]),
                    }))
                  : [
                      { value: "À faire", label: t("À faire") },
                      { value: "En cours", label: t("En cours") },
                      { value: "Validé", label: t("Terminées") },
                      { value: "late", label: t("En retard") },
                    ]),
            ]}
          />
          {page === "transactions" && (
            <button
              className="btn"
              onClick={exportCsv}
              disabled={!movements.length}
            >
              <Download size={15} />
              {t("Exporter CSV")}
            </button>
          )}
        </div>
        {page === "transactions" &&
          (movements.length || addingTx ? (
            <div className="print-table-scroll">
              <table>
                <thead>
                  <tr>
                    {[
                      "Date",
                      "Libellé",
                      "Interlocuteur",
                      "Catégorie",
                      "Commande",
                      "Montant",
                      "Actions",
                    ].map((h) => (
                      <th key={h} >
                        {t(h)}
                        
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {addingTx && (
                    <tr className="print-inline-add">
                      <td style={{ padding: "4px 8px" }}>
                        <input
                          type="date"
                          value={inlineTx.date}
                          onChange={(e) => setInlineTx({ ...inlineTx, date: e.target.value })}
                          style={{ padding: "4px 6px", fontSize: "12px", width: "115px" }}
                        />
                      </td>
                      <td style={{ padding: "4px 8px" }}>
                        <input
                          placeholder={t("Libellé")}
                          value={inlineTx.name}
                          onChange={(e) => setInlineTx({ ...inlineTx, name: e.target.value })}
                          style={{ padding: "4px 6px", fontSize: "12px", width: "120px" }}
                        />
                      </td>
                      <td style={{ padding: "4px 8px" }}>
                        <input
                          placeholder={t("Interlocuteur")}
                          value={inlineTx.party}
                          onChange={(e) => setInlineTx({ ...inlineTx, party: e.target.value })}
                          style={{ padding: "4px 6px", fontSize: "12px", width: "120px" }}
                        />
                      </td>
                      <td style={{ padding: "4px 8px" }}>
                        <input
                          placeholder={t("Catégorie")}
                          list="print-categories"
                          value={inlineTx.category}
                          onChange={(e) => setInlineTx({ ...inlineTx, category: e.target.value })}
                          style={{ padding: "4px 6px", fontSize: "12px", width: "120px" }}
                        />
                      </td>
                      <td style={{ padding: "4px 8px" }}>
                        <select
                          value={inlineTx.orderId}
                          onChange={(e) => setInlineTx({ ...inlineTx, orderId: e.target.value })}
                          style={{ padding: "4px 6px", fontSize: "12px", width: "120px", border: "1px solid var(--t-line-strong)", borderRadius: "4px" }}
                        >
                          <option value="">{t("Aucune")}</option>
                          {orders.map((o) => (
                            <option key={o.id} value={o.id}>{o.name}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: "4px 8px" }}>
                        <input
                          type="number"
                          placeholder="0.00"
                          step="0.01"
                          min="0.01"
                          value={inlineTx.amount}
                          onChange={(e) => setInlineTx({ ...inlineTx, amount: e.target.value })}
                          style={{ padding: "4px 6px", fontSize: "12px", width: "90px" }}
                        />
                      </td>
                      <td style={{ padding: "4px 8px" }}>
                        <div className="print-table-actions" style={{ gap: "4px" }}>
                          <button
                            className="btn primary"
                            style={{ padding: "4px 8px", minHeight: "28px", fontSize: "11px" }}
                            disabled={disabled || !inlineTx.name || !inlineTx.party || !inlineTx.amount}
                            onClick={async () => {
                              const amountCents = Math.round(parseFloat(inlineTx.amount) * 100);
                              if (isNaN(amountCents) || amountCents <= 0) return;
                              const success = await act({
                                action: "print-save",
                                kind: "print_transaction",
                                data: {
                                  direction: addingTx,
                                  transactionDate: inlineTx.date || p.today,
                                  name: inlineTx.name,
                                  counterparty: inlineTx.party,
                                  counterpartyType: addingTx === "in" ? "customer" : "supplier",
                                  expenseCategory: inlineTx.category || (addingTx === "in" ? t("Paiement commande") : t("Fournitures")),
                                  orderId: inlineTx.orderId || "",
                                  amountCents,
                                },
                              });
                              if (success) setAddingTx(null);
                            }}
                          >
                            {t("Ajouter")}
                          </button>
                          <button
                            className="btn ghost"
                            style={{ padding: "4px 8px", minHeight: "28px", fontSize: "11px" }}
                            onClick={() => setAddingTx(null)}
                          >
                            {t("Annuler")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                  {movements.map((r) => (
                    <tr
                      key={r.id}
                      className={r.archived ? "print-void" : ""}
                      
                    >
                      
                      <td>{date(r.transactionDate)}</td>
                      <td>
                        <span
                          className={`print-movement-icon ${r.direction === "in" ? "in" : "out"}`}
                        >
                          {r.direction === "in" ? (
                            <ArrowDownLeft size={16} />
                          ) : (
                            <ArrowUpRight size={16} />
                          )}
                        </span>
                        {r.name}
                        {r.archived && <small>{t("Annulée")}</small>}
                      </td>
                      <td>
                        {r.counterparty}
                        <small>
                          {t(
                            r.counterpartyType === "customer"
                              ? "Client"
                              : "Fournisseur",
                          )}
                        </small>
                      </td>
                      <td>{r.expenseCategory}</td>
                      <td>
                        {orders.find((o) => o.id === r.orderId)?.name ||
                          "—"}
                      </td>
                      <td
                        className={
                          r.direction === "in"
                            ? "print-green"
                            : "print-red"
                        }
                      >
                        {r.direction === "in" ? "+" : "−"}
                        {money(r.amountCents || 0)}
                      </td>
                      <td>
                        <div className="print-table-actions">
                          <button
                            className="btn subtle"
                            disabled={disabled}
                            aria-label={`${t("Modifier")} ${r.name}`}
                            onClick={() =>
                              setEditor({
                                kind: "print_transaction",
                                record: r,
                              })
                            }
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            type="button"
                            className="icon-button danger"
                            disabled={disabled}
                            aria-label={`${t("Supprimer")} ${r.name}`}
                            onClick={() => {
                              setError("");
                              setRemovingPayment(r);
                            }}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="print-empty">
              {t("Aucune transaction enregistrée")}
            </div>
          ))}
        {page === "orders" &&
          (shownOrders.length ? (
            <div className="print-order-grid">
              {shownOrders.map((order) => {
                const payment = orderPayment(p.records, order);
                return (
                  <Surface asChild tone="default" key={order.id}><article className="print-order">
                    <div className="print-order-top">
                      <span
                        className={`print-status ${order.orderStatus}`}
                      >
                        {t(
                          printOrderLabels[order.orderStatus || "new"],
                        )}
                      </span>
                      {manager && (
                        <button
                          className="btn subtle"
                          disabled={disabled}
                          aria-label={`${t("Modifier")} ${order.name}`}
                          onClick={() =>
                            setEditor({
                              kind: "print_order",
                              record: order,
                            })
                          }
                        >
                          <Pencil size={15} />
                        </button>
                      )}
                      {manager && (
                        <button
                          type="button"
                          className="icon-button danger"
                          disabled={disabled}
                          aria-label={`${t("Supprimer")} ${order.name}`}
                          onClick={() => {
                            setError("");
                            setRemovingOrder(order);
                          }}
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                    <h3>{order.name}</h3>
                    <p>{order.counterparty}</p>
                    <div className="print-order-meta">
                      <span>
                        {new Intl.NumberFormat(tag, { maximumFractionDigits: 2 }).format(order.quantity ?? 0)} {t(quantityUnitLabels[(order.quantityUnit ?? "unit") as QuantityUnit])}
                      </span>
                      <span
                        className={
                          order.due &&
                          order.due < p.today &&
                          !["delivered", "cancelled"].includes(
                            order.orderStatus || "",
                          )
                            ? "print-red"
                            : ""
                        }
                      >
                        {date(order.due)}
                      </span>
                    </div>
                    {order.description && (
                      <p className="print-description">
                        {order.description}
                      </p>
                    )}
                    {manager && (
                      <>
                        <div className="print-order-amount">
                          <strong>
                            {order.unitPriceCents !== undefined ? (
                              <span title={t("Détail du calcul")}>
                                {new Intl.NumberFormat(tag, { maximumFractionDigits: 2 }).format(order.quantity ?? 0)} {t(quantityUnitLabels[(order.quantityUnit ?? "unit") as QuantityUnit])} &times; {money(order.unitPriceCents)} = {money(order.amountCents || 0)}
                              </span>
                            ) : (
                              money(order.amountCents || 0)
                            )}
                          </strong>
                          <small>
                            {t("Reste à encaisser")}:{" "}
                            {money(payment.remaining)}
                          </small>
                        </div>
                        {progress(
                          order.amountCents
                            ? (payment.paid / order.amountCents) * 100
                            : 0,
                          "Paiement",
                        )}
                        <div className="print-actions">
                          <button
                            className="btn"
                            disabled={
                              disabled ||
                              order.orderStatus === "cancelled"
                            }
                            onClick={() =>
                              setEditor({
                                kind: "task",
                                orderId: order.id,
                              })
                            }
                          >
                            <Plus size={14} />
                            {t("Tâche")}
                          </button>
                          <button
                            className="btn"
                            disabled={disabled}
                            onClick={() =>
                              setEditor({
                                kind: "print_transaction",
                                orderId: order.id,
                                direction: "in",
                              })
                            }
                          >
                            {t("Encaisser")}
                          </button>
                        </div>
                      </>
                    )}
                  </article></Surface>
                );
              })}
            </div>
          ) : (
            empty("Aucune commande")
          ))}
      </section></Surface>
    </>
  );
}
