"use client";
// The print workspace invoices and quotes: the list, with editing, PDF and deletion.
import { computeTotals, docLabels, docStatusesFor, docStatusLabels } from "@/lib/documents";
import type { RecordItem, DocStatus, DocType } from "@/lib/model";
import { printDocumentHtml } from "@/lib/print-html";
import { Archive, FileSignature, Loader2, Download, Trash2 } from "lucide-react";
import type { PrintContext } from "./use-print-workspace";

export function PrintFactures({ ctx }: { ctx: PrintContext }) {
  const { t, date, setFactureDraft, pdfBusy, setPdfBusy, factures, setDeletingFacture, setError, disabled, money, act, empty } = ctx;
  return (
    <section className="print-section">
      {factures.length ? (
        <div className="print-table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t("Numéro")}</th>
                <th>{t("Type")}</th>
                <th>{t("Client")}</th>
                <th>{t("Statut")}</th>
                <th>{t("Total")}</th>
                <th>{t("Émis le")}</th>
                <th className="action-col"></th>
              </tr>
            </thead>
            <tbody>
              {factures.map((doc) => {
                const { total } = computeTotals(
                  doc.lineItems || [],
                  doc.taxRate,
                );
                // Backwards compatibility for incorrectly saved doc.number objects
                const docNum = typeof doc.number === "object" && doc.number !== null ? (doc.number as { number?: string }).number : doc.number;
                return (
                  <tr key={doc.id}>
                    <td>
                      <strong>{docNum}</strong>
                    </td>
                    <td>{t(docLabels[doc.docType as DocType || "facture"])}</td>
                    <td>{doc.counterparty}</td>
                    <td>
                      <span
                        className={`status s${docStatusesFor[doc.docType as DocType || "facture"].indexOf((doc.docStatus as DocStatus) || "draft")}`}
                      >
                        {t(docStatusLabels[doc.docStatus as DocStatus] || doc.docStatus || "draft")}
                      </span>
                    </td>
                    <td>{money(total * 100)}</td>
                    <td>
                      {doc.issuedAt
                        ? date(`${doc.issuedAt}T12:00:00`, {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })
                        : "—"}
                    </td>
                    <td className="action-col">
                      {pdfBusy === doc.id ? (
                        <Loader2 size={16} className="spin" />
                      ) : (
                        <button
                          type="button"
                          className="icon-button"
                          title={t("Télécharger")}
                          onClick={async () => {
                            setPdfBusy(doc.id);
                            try {
                              const docNum = typeof doc.number === "object" && doc.number !== null ? (doc.number as { number?: string }).number : doc.number;
                              const html = printDocumentHtml({
                                ...doc,
                                number: docNum
                              });
                              
                              const iframe = document.createElement('iframe');
                              iframe.style.position = 'fixed';
                              iframe.style.right = '0';
                              iframe.style.bottom = '0';
                              iframe.style.width = '0';
                              iframe.style.height = '0';
                              iframe.style.border = '0';
                              document.body.appendChild(iframe);
                              
                              const docIframe = iframe.contentWindow?.document;
                              if (docIframe) {
                                docIframe.open();
                                docIframe.write(html);
                                docIframe.close();
                                // Cleanup after print dialog is closed
                                setTimeout(() => {
                                  if (document.body.contains(iframe)) document.body.removeChild(iframe);
                                  setPdfBusy("");
                                }, 3000);
                              } else {
                                setPdfBusy("");
                              }
                            } catch {
                              setError(t("Génération du PDF impossible."));
                              setPdfBusy("");
                            }
                          }}
                        >
                          <Download size={15} />
                        </button>
                      )}
                      {doc.docStatus === "draft" && (
                        <button
                          type="button"
                          className="icon-button"
                          title={t("Modifier")}
                          onClick={() =>
                            setFactureDraft({
                              id: doc.id,
                              revision: doc.revision,
                              docType: doc.docType as DocType,
                              docStatus: (doc.docStatus as DocStatus) || "draft",
                              counterparty: doc.counterparty || "",
                              billing: doc.billing ?? null,
                              lineItems: doc.lineItems?.length
                                ? doc.lineItems
                                : [{ description: "", quantity: 1, unitPrice: 0 }],
                              taxRate: String(doc.taxRate ?? 0),
                              issuedAt: doc.issuedAt || "",
                              dueAt: doc.dueAt || "",
                              validUntil: doc.validUntil || "",
                              notes: doc.notes || "",
                            })
                          }
                        >
                          <FileSignature size={15} />
                        </button>
                      )}
                      {doc.docStatus !== "draft" && (
                        <button
                          type="button"
                          className="icon-button"
                          title={t("Archiver")}
                          disabled={disabled}
                          onClick={() =>
                            void act({
                              action: "print-save",
                              kind: "print_document",
                              id: doc.id,
                              revision: doc.revision,
                              // The required fields identify the document; everything the
                              // payload leaves out keeps its stored value.
                              data: {
                                docType: doc.docType,
                                docStatus: doc.docStatus,
                                counterparty: doc.counterparty,
                                lineItems: doc.lineItems || [],
                                archived: true,
                              },
                            })
                          }
                        >
                          <Archive size={15} />
                        </button>
                      )}
                      <button
                        type="button"
                        className="icon-button danger"
                        title={t("Supprimer")}
                        disabled={disabled}
                        onClick={() => setDeletingFacture(doc as unknown as RecordItem)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        empty("Aucune facture")
      )}
    </section>
  );
}
