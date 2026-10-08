"use client";
// The print workspace's state and data: the page, search and filter, the reporting period and what
// falls in it, the editors and confirmations in progress, and the save helper with its messages.
import { dashboardPeriod } from "@/features/dashboard/dashboard-period";
import { useI18n } from "@/lib/i18n/locale-provider";
import type { RecordItem } from "@/lib/model";
import { orderPayment, printTotals } from "@/lib/printing";
import { isManager } from "@/lib/workspace";
import { FileSignature, LayoutDashboard, Activity, ArrowLeftRight, Package, Users } from "lucide-react";
import { useState } from "react";
import { movementsCsv, type Draft } from "./print-model";
import type { PrintEditor, PrintPage, PrintWorkspaceProps } from "./print-workspace";

export function usePrintWorkspace(p: PrintWorkspaceProps) {
  const { t, tag, date } = useI18n();
  const manager = isManager(p.workspace.role);
  const [page, setPage] = useState<PrintPage>("dashboard");
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
  const [editor, setEditorState] = useState<PrintEditor | null>(null);
  // Kept through the dialog's close animation so the title doesn't flip to the default
  // ("Nouvelle entrée") while the just-saved order/task form is still fading out.
  const [lastEditor, setLastEditor] = useState<PrintEditor | null>(null);
  const setEditor = (next: PrintEditor | null) => {
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
  function navigate(next: PrintPage) {
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
    const url = URL.createObjectURL(
      new Blob([movementsCsv(movements, orders, t)], { type: "text/csv;charset=utf-8" }),
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
  return {
    t, tag, date, manager, page, setPage, query, setQuery, filter, setFilter, month, setMonth, periodKey, setPeriodKey, period, inPeriod, addingTx, setAddingTx, editor, setEditorState, lastEditor, setLastEditor, setEditor, dialogEditor, factureDraft, setFactureDraft, pdfBusy, setPdfBusy, factures, inlineTx, setInlineTx, removingPayment, setRemovingPayment, removingOrder, setRemovingOrder, deletingFacture, setDeletingFacture, error, setError, notice, setNotice, saving, setSaving, disabled, money, orders, transactions, totals, activeOrders, outstanding, months, nav, navigate, act, matches, movements, shownOrders, exportCsv, empty, progress, p,
  };
}
export type PrintContext = ReturnType<typeof usePrintWorkspace>;
