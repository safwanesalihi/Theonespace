"use client";
import { Surface } from "@/components/ui/surface";
import { FactureEditor } from "./FactureEditor";

import { useState, type FormEvent } from "react";
import WorkspaceFrame, {
  type WorkspaceFrameOptions,
} from "@/app/workspace-frame";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import DashboardPeriod, { dashboardPeriod } from "@/app/dashboard-period";
import DatePicker from "@/app/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Archive,
  FileSignature,
  Loader2,
  Printer,
  LayoutDashboard,
  Activity,
  ArrowLeftRight,
  Package,
  Users,
  Plus,
  ArrowDownLeft,
  ArrowUpRight,
  Search,
  Pencil,
  Download,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useI18n } from "@/app/locale-provider";
import TeamPage from "@/app/team";
import ActivityPage from "@/app/activity-page";
import type { RecordItem } from "@/lib/model";
import {
  isManager,
  memberName,
  type WorkspaceContext,
  type WorkspaceSummary,
  type WorkspaceMember,
  type MemberChange,
  type Invitation,
} from "@/lib/workspace";
import {
  orderPayment,
  printTotals,
  printOrderStatuses,
  printOrderLabels,
  parseQuantity,
  quantityUnitLabels,
  quantityUnits,
  type PrintKind,
  type QuantityUnit,
} from "@/lib/printing";
import { printDocumentHtml } from "@/lib/print-html";
import { computeTotals, docLabels, docStatusesFor, docStatusLabels } from "@/lib/documents";
import type { BillingDetails, DocStatus, DocType, LineItem } from "@/lib/model";

type Props = {
  frameOptions: WorkspaceFrameOptions;
  records: RecordItem[];
  workspace: WorkspaceContext;
  workspaces: WorkspaceSummary[];
  members: WorkspaceMember[];
  user: { id: string; name: string };
  busy: boolean;
  loading: boolean;
  error: string;
  today: string;
  mailConfigured: boolean;
  mutate: (body: unknown) => Promise<unknown>;
  onSwitch: (id: string) => Promise<void>;
  onRefresh: () => void;
  onMember: (change: MemberChange) => Promise<Invitation | void>;
  onLogout: () => void;
};
type Page = "dashboard" | "transactions" | "orders" | "factures" | "team" | "activity";
type Editor = {
  kind: PrintKind;
  record?: RecordItem;
  direction?: "in" | "out";
  orderId?: string;
};

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

const emptyDraft = (docType: DocType): Draft => ({
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


export default function PrintWorkspace(p: Props) {
  const { t, tag, date } = useI18n();
  const manager = isManager(p.workspace.role);
  const [page, setPage] = useState<Page>("dashboard");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [month, setMonth] = useState(p.today.slice(0, 7));
  const [periodKey, setPeriodKey] = useState("month");
  const period = dashboardPeriod(p.today, periodKey, month);
  const inPeriod = (r: RecordItem) =>
    !period ||
    (!!r.transactionDate &&
      r.transactionDate >= period.from &&
      r.transactionDate <= period.to);
  const [addingTx, setAddingTx] = useState<"in" | "out" | null>(null);
  const [editor, setEditorState] = useState<Editor | null>(null);
  // Kept through the dialog's close animation so the title doesn't flip to the default
  // ("Nouvelle entrée") while the just-saved order/task form is still fading out.
  const [lastEditor, setLastEditor] = useState<Editor | null>(null);
  const setEditor = (next: Editor | null) => {
    setEditorState(next);
    if (next) setLastEditor(next);
  };
  const dialogEditor = editor ?? lastEditor;
  const [factureDraft, setFactureDraft] = useState<Draft | null>(null);
  const [pdfBusy, setPdfBusy] = useState("");
  const factures = p.records
    .filter((r) => r.kind === "print_document" && !r.archived)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  
  const [inlineTx, setInlineTx] = useState({
    direction: "in" as "in" | "out",
    date: p.today,
    name: "",
    party: "",
    category: "",
    orderId: "",
    amount: "",
  });
  const [removingPayment, setRemovingPayment] = useState<RecordItem | null>(null);
  const [removingOrder, setRemovingOrder] = useState<RecordItem | null>(null);
  const [deletingFacture, setDeletingFacture] = useState<RecordItem | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const disabled = p.busy || saving || p.loading;
  const money = (cents: number) =>
    new Intl.NumberFormat(tag, { style: "currency", currency: "MAD" }).format(
      cents / 100,
    );
  const orders = p.records.filter((r) => r.kind === "print_order");
  const transactions = p.records.filter((r) => r.kind === "print_transaction");
  const totals = printTotals(p.records.filter(inPeriod));
  const activeOrders = orders.filter(
    (r) => !["delivered", "cancelled"].includes(r.orderStatus || "new"),
  );
  const outstanding = orders
    .filter((r) => r.orderStatus !== "cancelled")
    .reduce((sum, r) => sum + orderPayment(p.records, r).remaining, 0);
  const months = Array.from({ length: 6 }, (_, index) => {
    const end = period?.to.slice(0, 7) || p.today.slice(0, 7);
    const d = new Date(`${end}-15T12:00:00`);
    d.setMonth(d.getMonth() - 5 + index);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const values = printTotals(p.records, key);
    return {
      name: date(`${key}-01`, { month: "short", year: "2-digit" }),
      income: values.income / 100,
      expenses: values.expenses / 100,
    };
  });
  const nav = [
    {
      id: "dashboard" as const,
      name: "Tableau de bord",
      icon: LayoutDashboard,
    },
    ...(manager
      ? [
          {
            id: "transactions" as const,
            name: "Entrées & sorties",
            icon: ArrowLeftRight,
          },
        ]
      : []),
    { id: "orders" as const, name: "Commandes", icon: Package },
    { id: "factures" as const, name: "Factures", icon: FileSignature },
    { id: "team" as const, name: "Équipe", icon: Users },
    ...(p.workspace.role === "owner" ? [{ id: "activity" as const, name: "Activité", icon: Activity }] : []),
  ];
  function navigate(next: Page) {
    setPage(next);
    setQuery("");
    setFilter("");
    setError("");
    setNotice("");
  }
  async function act(body: unknown) {
    if (disabled) return false;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await p.mutate(body);
      setNotice(t("Enregistré"));
      return true;
    } catch (e) {
      setError(t((e as Error).message));
      return false;
    } finally {
      setSaving(false);
    }
  }
  const matches = (r: RecordItem) =>
    [
      r.name,
      r.counterparty,
      r.assignee,
      r.expenseCategory,
      orders.find((o) => o.id === r.orderId)?.name,
    ].some((v) => v?.toLowerCase().includes(query.toLowerCase()));
  const movements = transactions
    .filter(
      (r) =>
        matches(r) &&
        inPeriod(r) &&
        (filter === "void"
          ? r.archived
          : !r.archived && (!filter || r.direction === filter)),
    )
    .sort(
      (a, b) =>
        (b.transactionDate || "").localeCompare(a.transactionDate || "") ||
        b.createdAt.localeCompare(a.createdAt),
    );
  const shownOrders = orders
    .filter((r) => matches(r) && (!filter || r.orderStatus === filter))
    .sort((a, b) => (a.due || "").localeCompare(b.due || ""));
  function exportCsv() {
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
    const cell = (value: string) =>
      `"${(/^[=+\-@\t\r]/.test(value) ? "'" + value : value).replaceAll('"', '""')}"`;
    const url = URL.createObjectURL(
      new Blob(
        ["\ufeff" + rows.map((row) => row.map(cell).join(";")).join("\r\n")],
        { type: "text/csv;charset=utf-8" },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `impression-${period ? period.from + "_" + period.to : "tout"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
  const empty = (text: string) => (
    <div className="print-empty">
      <Package size={30} />
      <h3>{t(text)}</h3>
      <p>{t("Les éléments enregistrés apparaîtront ici.")}</p>
    </div>
  );
  const progress = (value: number, label: string) => (
    <div className="print-progress">
      <div>
        <span>{t(label)}</span>
        <strong>{Math.round(value)}%</strong>
      </div>
      <progress
        max={100}
        value={Math.max(0, Math.min(100, value))}
        aria-label={t(label)}
      />
    </div>
  );

  return (
    <WorkspaceFrame
      {...p.frameOptions}
      tabs={nav.slice(0, 4).map((n) => ({ icon: n.icon, label: t(n.name), active: page === n.id, onClick: () => navigate(n.id) }))}
      navigation={
        <SidebarGroup>
          <SidebarGroupLabel>{t("GESTION DE L’ATELIER")}</SidebarGroupLabel>
          <SidebarMenu>
            {nav.map((n) => (
              <SidebarMenuItem key={n.id}>
                <SidebarMenuButton
                  className="nav-item"
                  isActive={page === n.id}
                  onClick={() => navigate(n.id)}
                >
                  <n.icon strokeWidth={1.5} />
                  <span>{t(n.name)}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      }
    >
      <main className="print-main" aria-busy={disabled}>
        <header className="topbar">
          <SidebarTrigger aria-label={t("Afficher le menu")} />
          <span>
            <Printer size={15} /> {p.workspace.name} <span>/</span>{" "}
            {t(nav.find((n) => n.id === page)?.name || "")}
          </span>
          <div className="grow" />
          <button
            className="icon-button"
            disabled={disabled}
            onClick={p.onRefresh}
            aria-label={t("Actualiser")}
          >
            <RefreshCw size={16} />
          </button>
        </header>
        <div className="print-content">
          {/* Team and Activity bring their own heading (shared with the studio). */}
          {page !== "team" && page !== "activity" && (
          <div className="print-heading">
            <div>
              <p className="print-eyebrow">
                {t("VOTRE ATELIER, EN UN COUP D’ŒIL")}
              </p>
              <h1>{t(nav.find((n) => n.id === page)?.name || "")}</h1>
              <p>
                {t(
                  page === "dashboard"
                    ? "Suivez votre activité, vos paiements et votre production."
                    : page === "transactions"
                      ? "Chaque dirham reçu ou dépensé, au même endroit."
                      : page === "orders"
                        ? "De la demande à la livraison, gardez le fil."
                        : "Générez devis et factures pour vos clients.",
                )}
              </p>
            </div>
            {manager && (
              <div className="print-actions">
                {(page === "dashboard" || page === "transactions") && (
                  <>
                    <button
                      className="btn"
                      disabled={disabled}
                      onClick={() => {
                        // The inline row lives in the transactions table.
                        if (page !== "transactions") navigate("transactions");
                        setAddingTx("out");
                        setInlineTx({
                          direction: "out",
                          date: p.today,
                          name: "",
                          party: "",
                          category: "",
                          orderId: "",
                          amount: "",
                        });
                      }}
                    >
                      <ArrowUpRight size={16} />
                      {t("Sortie")}
                    </button>
                    <button
                      className="btn primary"
                      disabled={disabled}
                      onClick={() => {
                        if (page !== "transactions") navigate("transactions");
                        setAddingTx("in");
                        setInlineTx({
                          direction: "in",
                          date: p.today,
                          name: "",
                          party: "",
                          category: "",
                          orderId: "",
                          amount: "",
                        });
                      }}
                    >
                      <Plus size={16} />
                      {t("Entrée")}
                    </button>
                  </>
                )}
                {page === "orders" && (
                  <button
                    className="btn primary"
                    disabled={disabled}
                    onClick={() => setEditor({ kind: "print_order" })}
                  >
                    <Plus size={16} />
                    {t("Nouvelle commande")}
                  </button>
                )}
                                {page === "factures" && (
                  <button
                    className="btn primary"
                    disabled={disabled}
                    onClick={() => setFactureDraft({ ...emptyDraft("facture"), issuedAt: p.today })}
                  >
                    <Plus size={16} />
                    {t("Nouvelle facture")}
                  </button>
                )}
              </div>
            )}
          </div>
          )}
          {(error || p.error) && (
            <div className="print-alert" role="alert">
              {error || t(p.error)}{" "}
              <button onClick={p.onRefresh}>{t("Actualiser")}</button>
            </div>
          )}
          {notice && (
            <p className="print-notice" role="status">
              {notice}
            </p>
          )}
          {(page === "transactions" || (page === "dashboard" && manager)) && (
            <div className="print-period">
              <DashboardPeriod
                value={periodKey}
                onChange={setPeriodKey}
                customMonth={month}
                onMonthChange={setMonth}
              />
              <small>
                {period
                  ? `${date(period.from)} → ${date(period.to, { day: "numeric", month: "short", year: "numeric" })}`
                  : t("Tout l’historique")}
              </small>
            </div>
          )}
          {page === "dashboard" && (
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
          )}
          {page === "factures" && (
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
          )}
          {["transactions", "orders"].includes(page) && (
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
          )}
          {page === "activity" && p.workspace.role === "owner" && (
            <ActivityPage workspaceId={p.workspace.id} members={p.members} today={p.today} />
          )}
          {page === "team" && (
            <TeamPage
              key={p.workspace.id}
              workspace={p.workspace}
              members={p.members}
              currentUserId={p.user.id}
              busy={disabled}
              mailConfigured={p.mailConfigured}
              onChange={p.onMember}
              onRefresh={p.onRefresh}
            />
          )}
        </div>
      </main>
      {factureDraft && (
        <FactureEditor 
          draft={factureDraft}
          t={t}
          
          saving={saving}
          onClose={() => setFactureDraft(null)}
          onSave={async (doc) => {
            const data = {
              docType: doc.docType,
              docStatus: doc.docStatus,
              counterparty: doc.counterparty,
              // null, not undefined: an absent field means "leave it as it is" server-side.
              billing: doc.billing
                ? { company: doc.billing.company, address: doc.billing.address, rc: doc.billing.rc, ice: doc.billing.ice, taxId: doc.billing.taxId }
                : null,
              lineItems: doc.lineItems.filter((li) => li.description.trim()),
              taxRate: doc.taxRate ? Number(doc.taxRate) : undefined,
              issuedAt: doc.issuedAt || undefined,
              dueAt: doc.dueAt || undefined,
              validUntil: doc.validUntil || undefined,
              notes: doc.notes || undefined,
            };
            const ok = await act({
              action: "print-save",
              kind: "print_document",
              id: doc.id,
              revision: doc.revision,
              data,
            });
            if (ok) { setFactureDraft(null); p.onRefresh(); }
          }}
        />
      )}
      <Dialog
        open={!!editor}
        onOpenChange={(open) => {
          if (!open && !disabled) {
            setEditor(null);
            setError("");
          }
        }}
      >
        <DialogContent className="tracker-modal print-dialog">
          <DialogHeader>
            <DialogTitle>
              {t(
                dialogEditor?.record
                  ? "Modifier"
                  : dialogEditor?.kind === "print_order"
                    ? "Nouvelle commande"
                    : dialogEditor?.kind === "task"
                      ? "Nouvelle tâche"
                      : dialogEditor?.direction === "out"
                        ? "Nouvelle sortie"
                        : "Nouvelle entrée",
              )}
            </DialogTitle>
            <DialogDescription>
              {t("Enregistré uniquement dans votre espace Impression.")}
            </DialogDescription>
          </DialogHeader>
          {dialogEditor && (
            <PrintForm
              key={`${dialogEditor.kind}-${dialogEditor.record?.id || "new"}-${dialogEditor.orderId || ""}`}
              editor={dialogEditor}
              orders={orders}
              members={p.members}
              today={p.today}
              disabled={disabled}
              error={error}
              onCancel={() => {
                setEditor(null);
                setError("");
              }}
              onSave={async (data) => {
                if (
                  await act({
                    action: "print-save",
                    kind: dialogEditor.kind,
                    id: dialogEditor.record?.id,
                    revision: dialogEditor.record?.revision,
                    data,
                  })
                )
                  setEditor(null);
                p.onRefresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!removingPayment}
        onOpenChange={(open) => {
          if (!open && !saving) setRemovingPayment(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Supprimer ce paiement ?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Ce mouvement sera définitivement supprimé et les totaux seront recalculés.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p className="print-alert" role="alert">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>{t("Annuler")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={disabled}
              onClick={(event) => {
                event.preventDefault();
                if (!removingPayment) return;
                void act({
                  action: "print-delete",
                  id: removingPayment.id,
                  revision: removingPayment.revision,
                }).then((ok) => {
                  if (ok) setRemovingPayment(null);
                });
              }}
            >
              {t(saving ? "Suppression…" : "Supprimer")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={!!removingOrder}
        onOpenChange={(open) => {
          if (!open && !saving) setRemovingOrder(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Supprimer cette commande ?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("La commande et ses tâches seront définitivement supprimées. Les paiements déjà encaissés restent dans les entrées & sorties, sans commande liée.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p className="print-alert" role="alert">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>{t("Annuler")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={disabled}
              onClick={(event) => {
                event.preventDefault();
                if (!removingOrder) return;
                void act({
                  action: "print-delete",
                  id: removingOrder.id,
                  revision: removingOrder.revision,
                }).then((ok) => {
                  if (ok) setRemovingOrder(null);
                });
              }}
            >
              {t(saving ? "Suppression…" : "Supprimer")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={!!deletingFacture}
        onOpenChange={(open) => {
          if (!open && !saving) setDeletingFacture(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Supprimer ce document ?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Cette facture/devis sera définitivement supprimée.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p className="print-alert" role="alert">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>{t("Annuler")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={disabled}
              onClick={(event) => {
                event.preventDefault();
                if (!deletingFacture) return;
                void act({
                  action: "print-delete",
                  id: deletingFacture.id,
                  revision: deletingFacture.revision,
                }).then((ok) => {
                  if (ok) setDeletingFacture(null);
                });
              }}
            >
              {t(saving ? "Suppression…" : "Supprimer")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </WorkspaceFrame>
  );
}

function Choice({
  value,
  defaultValue = "",
  onChange,
  label,
  items,
  name,
  disabled,
}: {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  label: string;
  items: { value: string; label: string }[];
  name?: string;
  disabled?: boolean;
}) {
  const { dir } = useI18n();
  const [selection, setSelection] = useState(defaultValue);
  const selected = value ?? selection;
  return (
    <div className="form-field">
      <Select
        value={selected || "__none"}
        dir={dir}
        disabled={disabled}
        onValueChange={(next) => {
          const v = next === "__none" ? "" : next;
          setSelection(v);
          onChange?.(v);
        }}
      >
        <SelectTrigger className="pick" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem
              key={item.value || "__none"}
              value={item.value || "__none"}
            >
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {name && <input type="hidden" name={name} value={selected} />}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone = "",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <Surface asChild tone="default"><section className={`print-stat ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </section></Surface>
  );
}

function PrintForm({
  editor,
  orders,
  members,
  today,
  disabled,
  error,
  onSave,
  onCancel,
}: {
  editor: Editor;
  orders: RecordItem[];
  members: WorkspaceMember[];
  today: string;
  disabled: boolean;
  error: string;
  onSave: (data: unknown) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const r = editor.record;
  const linked = orders.find((o) => o.id === (editor.orderId || r?.orderId));
  const [direction, setDirection] = useState(
    r?.direction || editor.direction || "in",
  );
  const [partyType, setPartyType] = useState(
    r?.counterpartyType || (direction === "in" ? "customer" : "supplier"),
  );
  const [party, setParty] = useState(
    r?.counterparty || linked?.counterparty || "",
  );
  const [orderId, setOrderId] = useState(r?.orderId || editor.orderId || "");
  const [transactionDate, setTransactionDate] = useState(
    r?.transactionDate || today,
  );
  const [due, setDue] = useState(r?.due || linked?.due || today);
  const [quantity, setQuantity] = useState(r?.quantity ? String(r.quantity).replace(".", ",") : "1");
  const [unitPrice, setUnitPrice] = useState(r?.unitPriceCents !== undefined ? (r.unitPriceCents / 100).toString() : "");
  const [amount, setAmount] = useState(r?.amountCents !== undefined ? (r.amountCents / 100).toString() : "");

  function handleQuantityChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setQuantity(val);
    if (editor.kind !== "print_order") return;
    const q = parseQuantity(val);
    const up = parseFloat(unitPrice.replace(",", "."));
    if (!isNaN(q) && !isNaN(up) && q > 0) setAmount((q * up).toFixed(2));
  }

  function handleUnitPriceChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setUnitPrice(val);
    if (editor.kind !== "print_order") return;
    const q = parseQuantity(quantity);
    const up = parseFloat(val.replace(",", "."));
    if (!isNaN(q) && !isNaN(up) && q > 0) setAmount((q * up).toFixed(2));
  }

  function handleAmountChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setAmount(val);
    if (editor.kind !== "print_order") return;
    const q = parseQuantity(quantity);
    const total = parseFloat(val);
    if (!isNaN(q) && !isNaN(total) && q > 0) setUnitPrice((total / q).toFixed(2));
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const value = (key: string) => String(form.get(key) || "");
    const common = { name: value("name"), description: value("description") };
    const data =
      editor.kind === "print_transaction"
        ? {
            ...common,
            direction,
            amountCents: Math.round(Number(value("amount")) * 100),
            transactionDate,
            counterparty: party,
            counterpartyType: partyType,
            expenseCategory: value("expenseCategory"),
            orderId,
            archived: form.get("archived") === "on",
          }
        : editor.kind === "print_order"
          ? {
              ...common,
              counterparty: party,
              amountCents: Math.round(Number(value("amount")) * 100),
              unitPriceCents: value("unitPrice") ? Math.round(Number(value("unitPrice").replace(",", ".")) * 100) : undefined,
              quantity: parseQuantity(value("quantity")),
              quantityUnit: value("quantityUnit") || "unit",
              due,
              orderStatus: value("orderStatus"),
            }
          : {
              ...common,
              orderId,
              assigneeId: value("assigneeId"),
              due,
              status: value("status"),
            };
    await onSave(data);
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="print-form">
      <fieldset disabled={disabled}>
        <label>
          {t(editor.kind === "task" ? "Tâche" : "Libellé")}
          <input
            name="name"
            required
            maxLength={160}
            defaultValue={r?.name || ""}
            autoFocus
            placeholder={t(
              editor.kind === "print_order"
                ? "Ex. 500 cartes de visite"
                : editor.kind === "task"
                  ? "Ex. Découpe et finition"
                  : "Ex. Acompte ou achat de papier",
            )}
          />
        </label>
        {editor.kind === "print_transaction" && (
          <div className="print-form-row">
            <label>
              {t("Type")}
              <Choice
                label={t("Type")}
                value={direction}
                disabled={disabled}
                onChange={(value) => setDirection(value as "in" | "out")}
                items={[
                  { value: "in", label: t("Entrée") },
                  { value: "out", label: t("Sortie") },
                ]}
              />
            </label>
            <label>
              {t("Date")}
              <DatePicker
                label={t("Date")}
                value={transactionDate}
                onChange={setTransactionDate}
              />
            </label>
          </div>
        )}
        {editor.kind !== "task" && (
          <>
            <div className="print-form-row">
              <label>
                {t("Interlocuteur")}
                <input
                  required
                  maxLength={160}
                  value={party}
                  onChange={(e) => setParty(e.target.value)}
                />
              </label>
              {editor.kind === "print_transaction" ? (
                <label>
                  {t("Client / Fournisseur")}
                  <Choice
                    label={t("Client / Fournisseur")}
                    value={partyType}
                    disabled={disabled}
                    onChange={(value) =>
                      setPartyType(value as "customer" | "supplier")
                    }
                    items={[
                      { value: "customer", label: t("Client") },
                      { value: "supplier", label: t("Fournisseur") },
                    ]}
                  />
                </label>
              ) : (
                <label>
                  {t("Quantité")}
                  {/* Pieces, or metres / m² of roll: « 1,4 » or « 1.9 » both work. */}
                  <span className="print-quantity">
                    <input
                      type="text"
                      inputMode="decimal"
                      name="quantity"
                      required
                      pattern="\s*\d+([.,]\d{1,2})?\s*"
                      title={t("Un nombre, avec virgule si besoin : 12 ou 1,4")}
                      value={quantity}
                      onChange={handleQuantityChange}
                    />
                    <select name="quantityUnit" defaultValue={r?.quantityUnit || "unit"} aria-label={t("Unité")}>
                      {quantityUnits.map((u) => <option key={u} value={u}>{t(quantityUnitLabels[u])}</option>)}
                    </select>
                  </span>
                </label>
              )}
            </div>
            <div className="print-form-row">
              {editor.kind === "print_order" && (
                <label>
                  {t("Prix unitaire (MAD)")}
                  <input
                    type="number"
                    name="unitPrice"
                    step="0.01"
                    min="0"
                    max="1000000"
                    value={unitPrice}
                    onChange={handleUnitPriceChange}
                  />
                </label>
              )}
              <label>
                {t(
                  editor.kind === "print_order"
                    ? "Total commande (MAD)"
                    : "Montant (MAD)",
                )}
                <input
                  type="number"
                  name="amount"
                  required
                  step="0.01"
                  min={editor.kind === "print_order" ? 0 : 0.01}
                  max={1000000000}
                  value={amount}
                  onChange={handleAmountChange}
                />
              </label>
              {editor.kind === "print_transaction" && (
                <label>
                  {t("Catégorie")}
                  <input
                    name="expenseCategory"
                    list="print-categories"
                    required
                    maxLength={80}
                    defaultValue={
                      r?.expenseCategory ||
                      (direction === "in"
                        ? t("Paiement commande")
                        : t("Fournitures"))
                    }
                  />
                  <datalist id="print-categories">
                    {[
                      "Paiement commande",
                      "Fournitures",
                      "Transport",
                      "Salaires",
                      "Loyer",
                      "Remboursement",
                      "Autre",
                    ].map((v) => (
                      <option key={v} value={t(v)} />
                    ))}
                  </datalist>
                </label>
              )}
            </div>
          </>
        )}
        {editor.kind !== "print_order" && (
          <label>
            {t("Commande liée")}
            <Choice
              label={t("Commande liée")}
              value={orderId}
              disabled={disabled}
              onChange={(value) => {
                setOrderId(value);
                if (
                  partyType === "customer" &&
                  editor.kind === "print_transaction"
                )
                  setParty(
                    orders.find((o) => o.id === value)?.counterparty || party,
                  );
              }}
              items={[
                { value: "", label: t("Sans commande") },
                ...orders
                  .filter(
                    (o) =>
                      editor.kind === "print_transaction" ||
                      o.orderStatus !== "cancelled" ||
                      o.id === orderId,
                  )
                  .map((o) => ({ value: o.id, label: o.name })),
              ]}
            />
          </label>
        )}
        {editor.kind === "task" && (
          <label>
            {t("Responsable")}
            <Choice
              label={t("Responsable")}
              name="assigneeId"
              defaultValue={r?.assigneeId || ""}
              disabled={disabled}
              items={[
                { value: "", label: t("À prendre") },
                ...members
                  .filter((m) =>
                    ["owner", "admin", "print_operator"].includes(m.role),
                  )
                  .map((m) => ({ value: m.userId, label: memberName(m) })),
              ]}
            />
          </label>
        )}
        {editor.kind !== "print_transaction" && (
          <div className="print-form-row">
            <label>
              {t("Échéance")}
              <DatePicker label={t("Échéance")} value={due} onChange={setDue} />
            </label>
            <label>
              {t("Statut")}
              <Choice
                label={t("Statut")}
                name={editor.kind === "task" ? "status" : "orderStatus"}
                disabled={disabled}
                defaultValue={
                  editor.kind === "task"
                    ? r?.status === "À valider"
                      ? "En cours"
                      : r?.status || "À faire"
                    : r?.orderStatus || "new"
                }
                items={
                  editor.kind === "task"
                    ? [
                        { value: "À faire", label: t("À faire") },
                        { value: "En cours", label: t("En cours") },
                        { value: "Validé", label: t("Terminée") },
                      ]
                    : printOrderStatuses.map((value) => ({
                        value,
                        label: t(printOrderLabels[value]),
                      }))
                }
              />
            </label>
          </div>
        )}
        <label>
          {t("Notes")}
          <textarea
            name="description"
            rows={3}
            maxLength={5000}
            defaultValue={r?.description || ""}
          />
        </label>
        {editor.kind === "print_transaction" && r && (
          <label className="print-checkbox">
            <input
              type="checkbox"
              name="archived"
              defaultChecked={r.archived}
            />
            {t("Annuler ce mouvement (exclu des totaux)")}
          </label>
        )}
        {error && (
          <p role="alert" className="print-alert">
            {error}
          </p>
        )}
        <div className="print-form-footer">
          <button type="button" className="btn" onClick={onCancel}>
            {t("Annuler")}
          </button>
          <button type="submit" className="btn primary">
            {t(disabled ? "Enregistrement…" : "Enregistrer")}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
