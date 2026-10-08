"use client";
// The print workspace's small parts and its record form: a choice list, a statistic, and the form
// that creates or edits a cash movement, an order or an order's task.
import DatePicker from "@/components/date-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Surface } from "@/components/ui/surface";
import { useI18n } from "@/lib/i18n/locale-provider";
import type { RecordItem } from "@/lib/model";
import { printOrderStatuses, printOrderLabels, parseQuantity, quantityUnitLabels, quantityUnits } from "@/lib/printing";
import { memberName, type WorkspaceMember } from "@/lib/workspace";
import { useState, type FormEvent } from "react";
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
import type { PrintEditor } from "./print-workspace";
import type { PrintContext } from "./use-print-workspace";

/** Confirms the permanent deletion of a payment, an order or a document of the print workspace. */
export function ConfirmPrintDelete({ ctx, record, onClose, title, description }: {
  ctx: Pick<PrintContext, "t" | "error" | "saving" | "disabled" | "act">;
  record: RecordItem | null;
  onClose: () => void;
  title: string;
  description: string;
}) {
  const { t, error, saving, disabled, act } = ctx;
  return (
    <AlertDialog
      open={!!record}
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {description}
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
              if (!record) return;
              void act({
                action: "print-delete",
                id: record.id,
                revision: record.revision,
              }).then((ok) => {
                if (ok) onClose();
              });
            }}
          >
            {t(saving ? "Suppression…" : "Supprimer")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function Choice({
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

export function Stat({
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

export function PrintForm({
  editor,
  orders,
  members,
  today,
  disabled,
  error,
  onSave,
  onCancel,
}: {
  editor: PrintEditor;
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
