import { database } from "@/lib/database";
import { insertRecord } from "@/lib/flow-server";
import type { RecordItem } from "@/lib/model";
import { printSchemas, type PrintKind } from "@/lib/printing";
import { isManager, type WorkspaceContext } from "@/lib/workspace";

// Called only after authentication, origin validation and membership resolution.
export async function mutatePrinting(
  workspace: WorkspaceContext,
  userId: string,
  actor: string,
  body: Record<string, unknown>,
  rows: RecordItem[],
) {
  const fail = (error: string, status: number) => ({ error, status });
  if (
    !["print-save", "print-task-status", "print-delete"].includes(
      String(body.action),
    )
  )
    return fail("Action invalide.", 400);
  const manager = isManager(workspace.role);
  const existing = body.id ? rows.find((r) => r.id === body.id) : undefined;
  if (body.id && !existing) return fail("Élément introuvable.", 404);
  if (existing && body.revision !== existing.revision)
    return fail("Cet élément a changé. Actualisez avant de réessayer.", 409);
  if (body.action === "print-delete") {
    if (!isManager(workspace.role))
      return fail("Réservé au propriétaire et aux administrateurs.", 403);
    if (!existing || !["print_transaction", "print_document", "print_order"].includes(existing.kind))
      return fail("Élément introuvable ou non supprimable.", 404);
    const deleted = await database().transaction(async (tx) => {
      const rows = await tx.query(
        "DELETE FROM records WHERE workspace_id = $1 AND id = $2 AND revision = $3 RETURNING id",
        [workspace.id, existing.id, body.revision],
      );
      if (!rows.length) return false;
      if (existing.kind === "print_order") {
        // The order's production tasks go with it; its payments stay in the ledger, detached,
        // so the cash history is never silently rewritten.
        await tx.query(
          "DELETE FROM records WHERE workspace_id = $1 AND kind = 'task' AND data->>'orderId' = $2",
          [workspace.id, existing.id],
        );
        await tx.query(
          `UPDATE records SET data = jsonb_set(data, '{orderId}', '""'::jsonb), revision = revision + 1
           WHERE workspace_id = $1 AND kind = 'print_transaction' AND data->>'orderId' = $2`,
          [workspace.id, existing.id],
        );
      }
      return true;
    });
    if (!deleted)
      return fail("Cet élément a changé. Actualisez avant de réessayer.", 409);
    return { id: existing.id, status: 200 };
  }
  const now = new Date().toISOString();
  let item: RecordItem;
  if (body.action === "print-task-status") {
    if (!existing || existing.kind !== "task" || existing.archived)
      return fail("Tâche introuvable.", 404);
    if (
      !manager &&
      (workspace.role !== "print_operator" ||
        (existing.assigneeId
          ? existing.assigneeId !== userId
          : !!existing.assignee?.trim()))
    )
      return fail("Cette tâche ne vous est pas attribuée.", 403);
    if (!["À faire", "En cours", "Validé"].includes(String(body.status)))
      return fail("Statut invalide.", 400);
    item = { ...existing, status: body.status as RecordItem["status"] };
  } else {
    if (!manager)
      return fail("Réservé au propriétaire et aux administrateurs.", 403);
    const kind = body.kind as PrintKind;
    if (
      !Object.hasOwn(printSchemas, kind) ||
      (existing && existing.kind !== kind)
    )
      return fail("Type invalide.", 400);
    const parsed = printSchemas[kind].safeParse(body.data);
    if (!parsed.success) return fail(parsed.error.issues[0].message, 400);
    // Every printing schema's fields are a subset of RecordItem; only `name` differs, since a
    // devis/facture carries no free-text name — its number (or its client) stands in for one.
    const data = parsed.data as Partial<RecordItem>;
    // These schemas are strict and full of defaults, so a partial payload would otherwise blank
    // every field it left out (archiving a facture used to renumber it and erase its dates, tax
    // rate, notes and company details). On an update only the fields actually sent are applied.
    const sent = (body.data ?? {}) as Record<string, unknown>;
    const changes: Partial<RecordItem> = existing
      ? Object.fromEntries(Object.entries(data).filter(([key]) => key in sent))
      : data;
    item = {
      ...existing,
      ...changes,
      name: changes.name || changes.number || changes.counterparty || existing?.name || "",
      id: existing?.id || crypto.randomUUID(),
      kind,
      revision: existing?.revision || 1,
      createdAt: existing?.createdAt || now,
    };
    // Unticking "company client" sends `billing: null`, which removes the stored block; leaving
    // the field out entirely keeps whatever is there, like every other field.
    if (kind === "print_document" && "billing" in sent && !sent.billing) delete item.billing;
    if (item.orderId) {
      const order = rows.find(
        (r) => r.id === item.orderId && r.kind === "print_order",
      );
      if (!order) return fail("Commande introuvable dans cet espace.", 400);
      if (kind === "task" && order.orderStatus === "cancelled")
        return fail("Cette commande est annulée.", 400);
    }
    if (kind === "task") {
      const assigned = item.assigneeId
        ? await database().query<{ name: string; email: string }>(
            "SELECT name, email FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 AND role IN ('owner', 'admin', 'print_operator')",
            [workspace.id, item.assigneeId],
          )
        : [];
      if (item.assigneeId && !assigned.length)
        return fail("Choisissez un membre de cet espace.", 400);
      item.assignee = assigned[0]?.name || assigned[0]?.email || "";
      // Legacy printing tasks remain editable without studio relationships or approval rules.
      delete item.clientId;
      delete item.projectId;
      delete item.approvalDueAt;
      delete item.signOff;
    }
    if (kind === "print_document") {
      if (!item.number) {
        const { nextDocNumber } = await import("./documents");
        const existingNumbers = rows
          .filter((r) => r.kind === "print_document" && r.docType === item.docType && r.number)
          .map((r) => r.number as string);
        const year = new Date(item.issuedAt || item.createdAt || now).getFullYear();
        item.number = nextDocNumber(existingNumbers, item.docType as import("./model").DocType, year).number;
      }
    }
  }
  item.history = [
    ...(existing?.history || []),
    {
      text: `${actor} · ${existing ? "Modifié" : "Créé"}${body.action === "print-task-status" ? ` · ${item.status}` : ""}`,
      date: now,
    },
  ].slice(-100);
  if (existing) {
    const updated = await database().query(
      "UPDATE records SET data = $1::jsonb, revision = revision + 1 WHERE workspace_id = $2 AND id = $3 AND revision = $4 RETURNING id",
      [JSON.stringify(item), workspace.id, item.id, body.revision],
    );
    if (!updated.length)
      return fail("Modification simultanée. Actualisez votre espace.", 409);
  } else {
    const statement = insertRecord(item, userId, workspace.id);
    await database().query(statement.text, statement.params);
  }
  return { id: item.id, status: 200 };
}
