"use client";
// The print workspace (The One Print): the owner's second business, with its own cash movements,
// orders, invoices, team and activity. This file is the shell (navigation, heading, period, pages and
// dialogs); the state lives in use-print-workspace.tsx and each page in its own module.
import { FactureEditor } from "./facture-editor";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarTrigger } from "@/components/ui/sidebar";
import ActivityPage from "@/features/activity/activity-page";
import DashboardPeriod from "@/features/dashboard/dashboard-period";
import TeamPage from "@/features/team/team";
import WorkspaceFrame from "@/features/workspace/workspace-frame";
import { Printer, Plus, ArrowUpRight, RefreshCw } from "lucide-react";
import type { PrintKind } from "@/lib/printing";
import type { RecordItem } from "@/lib/model";
import type { Invitation, MemberChange, WorkspaceContext, WorkspaceMember, WorkspaceSummary } from "@/lib/workspace";
import type { WorkspaceFrameOptions } from "@/features/workspace/workspace-frame";
import { ConfirmPrintDelete, PrintForm } from "./print-form";
import { PrintDashboard } from "./print-dashboard";
import { PrintFactures } from "./print-factures";
import { PrintLedger } from "./print-ledger";
import { emptyDraft } from "./print-model";
import { usePrintWorkspace } from "./use-print-workspace";

export type PrintWorkspaceProps = {
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
export type PrintPage = "dashboard" | "transactions" | "orders" | "factures" | "team" | "activity";
/** What the record dialog edits: a cash movement, an order or a task, new or existing. */
export type PrintEditor = {
  kind: PrintKind;
  record?: RecordItem;
  direction?: "in" | "out";
  orderId?: string;
};

export default function PrintWorkspace(p: PrintWorkspaceProps) {
  const ctx = usePrintWorkspace(p);
  const { t, date, manager, page, month, setMonth, periodKey, setPeriodKey, period, setAddingTx, editor, setEditor, dialogEditor, factureDraft, setFactureDraft, setInlineTx, removingPayment, setRemovingPayment, removingOrder, setRemovingOrder, deletingFacture, setDeletingFacture, error, setError, notice, saving, disabled, orders, nav, navigate, act } = ctx;
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
          {page === "dashboard" && <PrintDashboard ctx={ctx} />}
          {page === "factures" && <PrintFactures ctx={ctx} />}
          {["transactions", "orders"].includes(page) && <PrintLedger ctx={ctx} />}
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
      <ConfirmPrintDelete
        ctx={ctx}
        record={removingPayment}
        onClose={() => setRemovingPayment(null)}
        title={t("Supprimer ce paiement ?")}
        description={t("Ce mouvement sera définitivement supprimé et les totaux seront recalculés.")}
      />
      <ConfirmPrintDelete
        ctx={ctx}
        record={removingOrder}
        onClose={() => setRemovingOrder(null)}
        title={t("Supprimer cette commande ?")}
        description={t("La commande et ses tâches seront définitivement supprimées. Les paiements déjà encaissés restent dans les entrées & sorties, sans commande liée.")}
      />
      <ConfirmPrintDelete
        ctx={ctx}
        record={deletingFacture}
        onClose={() => setDeletingFacture(null)}
        title={t("Supprimer ce document ?")}
        description={t("Cette facture/devis sera définitivement supprimée.")}
      />
    </WorkspaceFrame>
  );
}
