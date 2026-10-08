// The print workspace's rules without React: an invoice draft, and the cash movements as a CSV file a
// spreadsheet opens safely. Tested in tests/print-model.mjs.
import type { BillingDetails, DocStatus, DocType, LineItem, RecordItem } from "@/lib/model";

/** An invoice or quote being edited (features/printing/facture-editor.tsx). */
export type Draft = {
  id?: string;
  revision?: number;
  docType: DocType;
  docStatus: DocStatus;
  counterparty: string;
  billing?: BillingDetails | null;
  lineItems: LineItem[];
  taxRate: string;
  issuedAt: string;
  dueAt: string;
  validUntil: string;
  notes: string;
};

export const emptyDraft = (docType: DocType): Draft => ({
  docType,
  docStatus: "draft",
  counterparty: "",
  lineItems: [{ description: "", quantity: 1, unitPrice: 0 }],
  taxRate: "20",
  issuedAt: "",
  dueAt: "",
  validUntil: "",
  notes: "",
});

/**
 * One CSV cell, quoted. A value a spreadsheet would read as a formula (=, +, -, @, tab, carriage
 * return) is prefixed with an apostrophe, so an exported file never runs what someone typed.
 */
export const csvCell = (value: string) =>
  `"${(/^[=+\-@\t\r]/.test(value) ? "'" + value : value).replaceAll('"', '""')}"`;

/** The period's cash movements as CSV (semicolons, CRLF, UTF-8 byte order mark for spreadsheets). */
export function movementsCsv(movements: RecordItem[], orders: RecordItem[], t: (text: string) => string) {
  const rows = [
    [
      t("Date"),
      t("Libellé"),
      t("Type"),
      t("Montant (MAD)"),
      t("Interlocuteur"),
      t("Client / Fournisseur"),
      t("Catégorie"),
      t("Commande"),
    ],
    ...movements.map((r) => [
      r.transactionDate || "",
      r.name,
      t(r.direction === "in" ? "Entrée" : "Sortie"),
      ((r.amountCents || 0) / 100).toFixed(2),
      r.counterparty || "",
      t(r.counterpartyType === "customer" ? "Client" : "Fournisseur"),
      r.expenseCategory || "",
      orders.find((o) => o.id === r.orderId)?.name || "",
    ]),
  ];
  return "﻿" + rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
}
