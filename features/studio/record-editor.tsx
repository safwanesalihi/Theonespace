"use client";
// The record editor: creating and editing clients, sub-projects and tasks, and the confirmations that
// share its dialog (archive or restore, delete, approve, request changes on behalf of the client). A
// save that falls inside the J−7 lock asks a manager to lift it (the lock prompt).
import type { FormEvent } from "react";
import { useState } from "react";
import DatePicker from "@/components/date-picker";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { AiFix } from "@/features/assistant/ai-assist";
import { AssigneePick, Pick } from "@/features/tasks/task-controls";
import { insideLock, shiftDay } from "@/lib/flow";
import { useI18n } from "@/lib/i18n/locale-provider";
import { taskReturnRoute } from "@/lib/navigation";
import { whatsappFormatHint, whatsappInputMaxLength } from "@/lib/whatsapp-number";
import { memberName, canManageMembers, isStudioRole } from "@/lib/workspace";
import { Lock, Loader2, Unlock } from "lucide-react";
import { requestPlatforms, type RecordItem, type Status } from "@/lib/model";
import { fieldsFor, flowFor, rulesOf, startStatus, statusInFlow, type FieldDef, type Process } from "@/lib/process";
import { useProcess } from "@/features/workspace/process-context";
import type { WorkspaceRoute } from "@/lib/navigation";
import type { WorkspaceContext } from "@/lib/workspace";
import type { EditorType, StudioActions, StudioData, StudioLookups, StudioRoles } from "@/features/workspace/screen-props";
import type { Mutation, WorkspacePayload } from "@/features/workspace/use-workspace-session";

export type EditorModal = { type: EditorType; record?: RecordItem; status?: Status; date?: string };
type Form = Record<string, string>;

/** A record without the fields the server manages (identity, revision, history, workflow stamps). */
export const clean = (r: RecordItem) => {
  const d: Record<string, unknown> = { ...r };
  [
    "id",
    "kind",
    "revision",
    "createdAt",
    "history",
    "sentAt",
    "validatedAt",
    "author",
    "approvalDueAt",
    "revisionRound",
    "signOff",
    "publishedAt",
    "lockOverride",
    "reminders",
    "request",
    "timeEntries",
  ].forEach((k) => delete d[k]);
  return d;
};

/** The editor's state, declared before navigation (Back clears a form error). */
export function useEditorState() {
  const [modal, setModal] = useState<EditorModal | null>(null),
    [form, setForm] = useState<Form>({}),
    [formError, setFormError] = useState(""),
    [lockPrompt, setLockPrompt] = useState<Mutation | null>(null);
  return { modal, setModal, form, setForm, formError, setFormError, lockPrompt, setLockPrompt };
}
export type EditorState = ReturnType<typeof useEditorState>;

type EditorDeps = {
  workspace: WorkspaceContext | null;
  /** The studio's process: new tasks start in its first status (lib/process.ts). */
  studioProcess: Process;
  roles: Pick<StudioRoles, "writable" | "owner" | "manager" | "member" | "can">;
  route: WorkspaceRoute;
  /** The client whose page is open (new tasks default to it). */
  client: RecordItem | null;
  clients: RecordItem[];
  projects: RecordItem[];
  today: string;
  mutate: (body: unknown) => Promise<WorkspacePayload>;
  navigate: StudioActions["navigate"];
  goBack: StudioActions["goBack"];
  setError: (message: string) => void;
  setNotice: (message: string) => void;
  tr: (text: string, vars?: Record<string, string | number>) => string;
};

/** The editor's actions over its state: open it, edit a field, submit, and save with the lock check. */
export function recordEditor(state: EditorState, deps: EditorDeps) {
  const { modal, setModal, form, setForm, setFormError, setLockPrompt } = state;
  const { workspace, studioProcess, roles: { writable, owner, member, can }, route, client, clients, projects, today, mutate, navigate, goBack, setError, setNotice, tr } = deps;
// J−7 lock: an admin gets a confirmation instead of a dead end.
async function save(body: Mutation) {
  try {
    return await mutate(body);
  } catch (e) {
    if (
      (e as { code?: string }).code === "lock" &&
      workspace &&
      canManageMembers(workspace.role)
    )
      setLockPrompt(body);
    throw e;
  }
}

function open(
  type: EditorType,
  record?: RecordItem,
  defaults: { status?: Status; date?: string } = {},
) {
  if (!writable) {
    setError(tr("Votre rôle est en lecture seule."));
    return;
  }
  if (type === "client" && !record && !owner) {
    setError(tr("Seul le propriétaire peut ajouter des clients."));
    return;
  }
  if (type === "client" && record && !can("clients")) {
    setError(
      tr(
        "Seuls le propriétaire et les administrateurs peuvent modifier la fiche d’un client.",
      ),
    );
    return;
  }
  if (type === "task" && !record && (!workspace || !can("tasks.create"))) {
    setError(
      tr("Les tâches sont créées par le propriétaire ou un administrateur."),
    );
    return;
  }
  setModal({ type, record, ...defaults });
  setFormError("");
  setForm(
    record
      ? ({
          ...Object.fromEntries(
            Object.entries(clean(record)).filter(
              ([, v]) => typeof v === "string",
            ),
          ),
          ...Object.fromEntries(Object.entries(record.fields ?? {}).map(([id, v]) => [`field:${id}`, String(v)])),
          evergreen: record.evergreen ? "true" : "",
          publishable: record.publishable === false ? "false" : "",
          postApproval: record.postApproval ? "true" : "",
          ...(type === "client" && record.brief ? { description: record.brief.overview } : {}),
        } as Form)
      : (() => {
          const clientId = route.page === "internal" ? "internal" : (client?.id || clients.find((c) => !c.archived)?.id || "");
          return {
            clientId,
            projectId:
              projects.find((p) => p.clientId === clientId && !p.archived)
                ?.id || "",
            name: "",
            status: defaults.status || startStatus(studioProcess),
            source: "",
            due: defaults.date || shiftDay(today, rulesOf(studioProcess).lockDays + 1),
            assignee: "",
            description: "",
            language: "Français",
          };
        })(),
  );
}

const set = (key: string, value: string) =>
  setForm((p) => ({
    ...p,
    [key]: value,
    ...(key === "clientId"
      ? {
          projectId:
            projects.find((x) => x.clientId === value && !x.archived)?.id ||
            "",
        }
      : {}),
    // Another work type is another path: the status moves to that path's matching step.
    ...(key === "workType" ? { status: statusInFlow(studioProcess, p.status, value) } : {}),
  }));

async function submit(e: FormEvent) {
  e.preventDefault();
  if (!modal) return;
  setFormError("");
  try {
    if (modal.type === "archive") {
      await mutate({
        action: "update",
        id: modal.record!.id,
        kind: modal.record!.kind,
        revision: modal.record!.revision,
        data: { ...clean(modal.record!), archived: !modal.record!.archived },
      });
      setModal(null);
      setNotice(
        tr(modal.record!.archived ? "Élément restauré" : "Élément archivé"),
      );
      return;
    }
    if (modal.type === "delete") {
      const t = modal.record!;
      await mutate({
        action: "delete",
        kind: t.kind,
        id: t.id,
        revision: t.revision,
      });
      setModal(null);
      setNotice(
        tr(
          t.kind === "client" ? "Client supprimé" : "Tâche supprimée",
        ),
      );
      if (route.page === "task" && route.id === t.id)
        goBack(taskReturnRoute(t.clientId));
      if (route.page === "client" && route.id === t.id)
        goBack({ page: "clients" }, (r) => r.page !== "client" && r.page !== "portal" && r.page !== "review");
      return;
    }
    if (modal.type === "internal-reject") {
      const t = modal.record!;
      if (!form.feedback?.trim()) throw Error(tr("Expliquez ce qu’il faut reprendre."));
      await mutate({ action: "internal-review", taskId: t.id, revision: t.revision, decision: "reject", text: form.feedback });
      setModal(null);
      setNotice(tr("Renvoyé en production avec votre note · le client ne voit rien"));
      return;
    }
    if (modal.type === "feedback" || modal.type === "approve") {
      const t = modal.record!;
      if (modal.type === "feedback" && !form.feedback?.trim())
        throw Error(tr("Précisez les modifications demandées."));
      let extraPending = false;
      // Studio preview actions are explicitly attributed to the signed-in owner.
      if (modal.type === "feedback") {
        const reply = await mutate({ action: "request-changes", taskId: t.id, text: form.feedback });
        extraPending = !!reply.extraRequestId;
      } else await mutate({ action: "approve", taskId: t.id });
      setModal(null);
      setNotice(
        tr(
          modal.type === "approve"
            ? "Validation enregistrée depuis le studio · reçu créé"
            : extraPending ? "Demande hors forfait enregistrée. Le livrable est en pause jusqu’à l’accord sur le devis extra." : "Retours enregistrés · tour de modifications compté",
        ),
      );
      return;
    }
    const data: Record<string, unknown> = { ...form };
    for (const key of Object.keys(data)) if (key.startsWith("field:")) delete data[key];
    if (modal.type === "task") {
      // The studio's own fields for this work type (lib/process.ts): sent only when the studio has some.
      const defs = fieldsFor(studioProcess, form);
      if (defs.length) data.fields = Object.fromEntries(defs.map((d) => [d.id, form[`field:${d.id}`] ?? ""]));
      if (!data.clientId) throw Error(tr("Choisissez un client."));
      data.evergreen = form.evergreen === "true";
      data.publishable = form.publishable !== "false";
    } else {
      delete data.evergreen;
      delete data.publishable;
    }
    if (modal.type === "client") data.postApproval = form.postApproval === "true";
    else delete data.postApproval;
    const result = await save({
      action: modal.record ? "update" : "create",
      kind: modal.type,
      id: modal.record?.id,
      revision: modal.record?.revision,
      data,
    });
    setModal(null);
    setNotice(
      tr(
        modal.type === "task" && form.deliverable && form.deliverable !== modal.record?.deliverable
          ? "Livrable envoyé en validation interne"
          : modal.record ? "Modifications enregistrées" : "Création enregistrée",
      ),
    );
    if (result?.whatsapp) {
      if (result.whatsapp.sent) setNotice(tr("Envoyé en validation · WhatsApp accepté par Meta"));
      else setError(tr(result.whatsapp.error || "L’envoi WhatsApp a échoué."));
    }
    if (result?.assignmentWhatsapp?.sent) setNotice(tr("Assignation enregistrée · WhatsApp accepté par Meta"));
    if (modal.type === "client") navigate({ page: "client", id: result.id });
    if (modal.type === "task") navigate({ page: "task", id: result.id });
  } catch (e) {
    setFormError(tr((e as Error).message));
  }
}

const modalTitle = tr(
  modal?.type === "delete"
    ? modal.record?.kind === "client"
      ? "Supprimer ce client"
      : "Supprimer cette tâche"
    : modal?.type === "archive"
      ? modal.record?.archived
        ? "Restaurer cet élément"
        : "Archiver cet élément"
      : modal?.type === "approve"
        ? "Valider ce livrable"
        : modal?.type === "internal-reject"
          ? "Refuser en validation interne"
          : modal?.type === "feedback"
          ? "Demander des modifications"
          : modal?.type === "client"
            ? modal.record
              ? "Modifier le client"
              : "Nouveau client"
            : modal?.type === "project"
              ? modal.record
                ? "Modifier le sous-projet"
                : "Nouveau sous-projet"
              : modal?.record
                  ? "Modifier la tâche"
                  : "Nouvelle tâche",
);
  // A member's only edit on a task is the deliverable link; every other field stays locked.
  const memberTaskOnly = member && modal?.type === "task" && !!modal.record;
  return { ...state, save, open, set, submit, memberTaskOnly, modalTitle };
}
export type RecordEditor = ReturnType<typeof recordEditor>;

export function RecordEditorDialog({ editor, data, roles, lookups }: {
  editor: RecordEditor;
  data: Pick<StudioData, "workspace" | "busy" | "clients" | "projects" | "members" | "today">;
  roles: Pick<StudioRoles, "writable">;
  lookups: Pick<StudioLookups, "avatarOf" | "titlesOf">;
}) {
  const { t: tr } = useI18n();
  const studio = useProcess();
  const { modal, setModal, form, formError, set, submit, memberTaskOnly, modalTitle } = editor;
  // The statuses offered are those of the task's own path (its work type, lib/process.ts flowFor).
  const process = flowFor(studio, form);
  const { workspace, busy, clients, projects, members, today } = data;
  const { writable } = roles;
  const { avatarOf, titlesOf } = lookups;
  return (
    <Dialog
      open={!!modal}
      onOpenChange={(o) => {
        if (!o && !busy) setModal(null);
      }}
    >
      <DialogContent className="tracker-modal">
        <DialogHeader>
          <DialogTitle>{modalTitle}</DialogTitle>
          <DialogDescription>
            {tr(
              modal?.type === "delete"
                ? modal.record?.kind === "client"
                  ? "Définitif : le client et toutes ses données associées seront supprimés."
                  : "Définitif : la tâche, ses commentaires et son historique disparaissent. Pour la garder hors des vues actives, préférez « Archiver »."
                : modal?.type === "archive"
                  ? "L’historique est conservé. Vous pourrez restaurer cet élément."
                  : modal?.type === "approve" || modal?.type === "feedback"
                    ? "Décision reçue hors portail (WhatsApp, réunion…), enregistrée au nom du studio et tracée dans l’historique."
                    : modal?.type === "internal-reject"
                      ? "La tâche repart « En cours » avec votre note. Elle reste dans le studio : le client ne la voit pas, et ce n’est pas un tour de retours."
                    : "Les modifications sont enregistrées dans votre espace privé.",
            )}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          {modal?.type === "delete" ? (
            <p className="confirm-copy">
              {tr("Supprimer « {name} » ?", {
                name: modal.record?.name ?? "",
              })}
            </p>
          ) : modal?.type === "archive" ? (
            <p className="confirm-copy">
              {tr(
                modal.record?.archived
                  ? "Restaurer « {name} » ?"
                  : "Archiver « {name} » ?",
                { name: modal.record?.name ?? "" },
              )}{" "}
              {modal.record?.kind !== "task" && !modal.record?.archived
                ? tr("Ses éléments associés seront masqués des vues actives.")
                : ""}
            </p>
          ) : modal?.type === "approve" ? (
            <p className="confirm-copy">
              {tr(
                "Confirmer la validation de « {name} » ? Le statut passera à « Validé ».",
                { name: modal.record?.name ?? "" },
              )}
            </p>
          ) : modal?.type === "internal-reject" ? (
            <label className="form-field">
              <span>{tr("Ce qu’il faut reprendre")}</span>
              <textarea
                autoFocus
                required
                maxLength={2000}
                rows={6}
                value={form.feedback || ""}
                onChange={(e) => set("feedback", e.target.value)}
                placeholder={tr("Précisez ce qui doit être ajusté…")}
              />
            </label>
          ) : modal?.type === "feedback" ? (
            <label className="form-field">
              <span>
                {tr("Modifications demandées")}
                {writable && (
                  <AiFix value={form.feedback || ""} kind="feedback" workspaceId={workspace?.id} onChange={(v) => set("feedback", v)} />
                )}
              </span>
              <textarea
                autoFocus
                required
                maxLength={5000}
                rows={6}
                value={form.feedback || ""}
                onChange={(e) => set("feedback", e.target.value)}
                placeholder={tr("Précisez ce qui doit être ajusté…")}
              />
            </label>
          ) : (
            <div className="form-fields">
              {memberTaskOnly && (
                <p className="confirm-copy">
                  {tr(
                    "En tant que membre, vous ne pouvez modifier que le lien livrable et le statut de « {name} ».",
                    { name: modal?.record?.name ?? "" },
                  )}
                </p>
              )}
              {memberTaskOnly && (
                <label className="form-field">
                  <span>{tr("Statut")}</span>
                  <Pick
                    label={tr("Statut")}
                    value={form.status || startStatus(process)}
                    onChange={(v) => set("status", v || startStatus(process))}
                    items={process.statuses
                      .filter((st) => ["todo", "work", "internal"].includes(st.behaviour) || st.id === form.status)
                      .map((st) => ({ value: st.id, label: tr(st.label) }))}
                  />
                </label>
              )}
              {!memberTaskOnly && (
                <label className="form-field title-field">
                  <span>
                    {tr("Nom *")}
                    {writable && modal?.type === "task" && (
                      <AiFix value={form.name || ""} kind="task" workspaceId={workspace?.id} onChange={(v) => set("name", v)} />
                    )}
                  </span>
                  <input
                    autoFocus
                    required
                    maxLength={160}
                    value={form.name || ""}
                    onChange={(e) => set("name", e.target.value)}
                    placeholder={tr(
                      modal?.type === "task" ? "Nom de la tâche" : "Nom",
                    )}
                  />
                </label>
              )}
              {modal?.type !== "client" && !memberTaskOnly && form.clientId !== "internal" && (
                <label className="form-field">
                  <span>{tr("Client *")}</span>
                  <Pick
                    label={tr("Client")}
                    value={form.clientId || ""}
                    onChange={(v) => set("clientId", v)}
                    items={clients
                      .filter((c) => !c.archived)
                      .map((c) => ({ value: c.id, label: c.name }))}
                  />
                </label>
              )}
              {modal?.type === "task" && !memberTaskOnly && form.clientId !== "internal" && (
                <label className="form-field">
                  <span>{tr("Sous-projet")}</span>
                  <Pick
                    label={tr("Sous-projet")}
                    emptyLabel={tr("Aucun sous-projet")}
                    value={form.projectId || ""}
                    onChange={(v) => set("projectId", v)}
                    items={projects
                      .filter(
                        (p) => p.clientId === form.clientId && !p.archived,
                      )
                      .map((p) => ({ value: p.id, label: p.name }))}
                  />
                </label>
              )}
              {modal?.type === "task" && !memberTaskOnly && (
                <>
                  <div className="form-pair">
                    <label className="form-field">
                      <span>{tr("Assigné")}</span>
                      <AssigneePick
                        label={tr("Assigné")}
                        emptyLabel={tr("Non assigné")}
                        value={form.assignee || ""}
                        onChange={(v) => set("assignee", v)}
                        items={[
                          ...new Set([
                            // Only the studio's people: a client contact is never assigned a task.
                            ...members.filter((m) => isStudioRole(m.role)).map(memberName),
                            ...(form.assignee ? [form.assignee] : []),
                          ]),
                        ].map((value) => ({
                          value,
                          avatar: avatarOf(value),
                          hint: titlesOf(value).map((title) => tr(title)).join(" · "),
                        }))}
                      />
                    </label>
                    <label className="form-field">
                      <span>{tr("Échéance")}</span>
                      <DatePicker
                        label={tr("Échéance")}
                        value={form.due || ""}
                        onChange={(value) => set("due", value)}
                      />
                    </label>
                    <label className="form-field">
                      <span>{tr("Priorité")}</span>
                      <Select value={form.priority || "Moyenne"} onValueChange={(v) => set("priority", v)}>
                        <SelectTrigger className="pick" aria-label={tr("Priorité")}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Basse">{tr("Basse")}</SelectItem>
                          <SelectItem value="Moyenne">{tr("Moyenne")}</SelectItem>
                          <SelectItem value="Haute">{tr("Haute")}</SelectItem>
                          <SelectItem value="Urgente">{tr("Urgente")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </label>
                  </div>
                  <div className="form-pair">
                    <label className="form-field">
                      <span>{tr("Lien de brief")}</span>
                      <input
                        type="url"
                        maxLength={2000}
                        value={form.source || ""}
                        onChange={(e) => set("source", e.target.value)}
                        placeholder="https://…"
                      />
                      <small>
                        {tr(
                          "Lien vers le brief, le message ou la demande client.",
                        )}
                      </small>
                    </label>
                    {!!studio.workTypes?.length && (
                      <label className="form-field">
                        <span>{tr("Type de travail")}</span>
                        <Pick
                          label={tr("Type de travail")}
                          value={form.workType || studio.workTypes[0].id}
                          onChange={(v) => v && set("workType", v)}
                          items={studio.workTypes.map((w) => ({ value: w.id, label: w.label }))}
                        />
                      </label>
                    )}
                    <label className="form-field">
                      <span>{tr("Statut")}</span>
                      <Pick
                        label={tr("Statut")}
                        value={form.status || startStatus(process)}
                        onChange={(v) => set("status", v || startStatus(process))}
                        items={process.statuses.map((st) => ({ value: st.id, label: tr(st.label) }))}
                      />
                    </label>
                  </div>
                  <CustomFieldInputs defs={fieldsFor(studio, form)} form={form} set={set} people={members.filter((m) => isStudioRole(m.role))} />
                </>
              )}
              {modal?.type === "task" && (
                <label className="form-field">
                  <span>{tr("Livrable")}</span>
                  <input
                    type="url"
                    maxLength={2000}
                    value={form.deliverable || ""}
                    onChange={(e) => set("deliverable", e.target.value)}
                    placeholder="https://…"
                  />
                  {memberTaskOnly && (
                    <small>
                      {tr(
                        "Ajouter un lien envoie automatiquement la tâche en validation.",
                      )}
                    </small>
                  )}
                </label>
              )}
              {modal?.type === "task" && !memberTaskOnly && (
                <>
                  <label className="form-check">
                    <input
                      type="checkbox"
                      checked={form.publishable !== "false"}
                      onChange={(e) =>
                        set("publishable", e.target.checked ? "" : "false")
                      }
                    />
                    <span>
                      <strong>{tr("Contenu publiable")}</strong>
                      <small>
                        {tr(
                          "Vidéo, affiche, post… Décochez pour un travail interne (copywriting, prémontage) : hors plan éditorial, sans jalons ni verrou.",
                        )}
                      </small>
                    </span>
                  </label>
                  <label className="form-check">
                    <input
                      type="checkbox"
                      checked={form.evergreen === "true"}
                      onChange={(e) =>
                        set("evergreen", e.target.checked ? "true" : "")
                      }
                    />
                    <span>
                      <strong>{tr("Réserve evergreen")}</strong>
                      <small>
                        {tr(
                          "Contenu sans date, validé à l’avance pour combler un trou du calendrier.",
                        )}
                      </small>
                    </span>
                  </label>
                  {form.due &&
                    form.publishable !== "false" &&
                    insideLock(form.due, today, rulesOf(studio).lockDays) &&
                    form.due !== modal.record?.due && (
                      <p className="lock-note">
                        <Lock size={13} />
                        {tr(
                          "Verrou J−{n} : cette date tombe dans la semaine gelée.",
                          { n: rulesOf(studio).lockDays },
                        )}{" "}
                        {canManageMembers(workspace?.role || "viewer")
                          ? tr(
                              "Vous pourrez lever le verrou à l’enregistrement.",
                            )
                          : tr("Un administrateur devra lever le verrou.")}
                      </p>
                    )}
                </>
              )}
              {modal?.type === "client" && (
                <>
                  <div className="form-pair">
                    <label className="form-field">
                      <span>{tr("Secteur")}</span>
                      <input
                        value={form.sector || ""}
                        onChange={(e) => set("sector", e.target.value)}
                      />
                    </label>
                    <label className="form-field">
                      <span>{tr("Ville")}</span>
                      <input
                        value={form.city || ""}
                        onChange={(e) => set("city", e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="form-pair">
                    <label className="form-field">
                      <span>{tr("Contact principal")}</span>
                      <input
                        value={form.contact || ""}
                        onChange={(e) => set("contact", e.target.value)}
                      />
                    </label>
                    <label className="form-field">
                      <span>{tr("E-mail")}</span>
                      <input
                        type="email"
                        value={form.email || ""}
                        onChange={(e) => set("email", e.target.value)}
                      />
                    </label>
                  </div>
                  <label className="form-field">
                    <span id="client-whatsapp-label">{tr("WhatsApp")}</span>
                    <input
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      dir="ltr"
                      aria-labelledby="client-whatsapp-label"
                      aria-describedby="client-whatsapp-format"
                      maxLength={whatsappInputMaxLength}
                      value={form.whatsapp || ""}
                      onChange={(e) => set("whatsapp", e.target.value)}
                      placeholder="0612345678"
                    />
                    <small id="client-whatsapp-format">{tr(whatsappFormatHint)}</small>
                    <small>
                      {tr("Reçoit un message WhatsApp chaque fois qu’un contenu est prêt à valider.")}
                    </small>
                  </label>
                  <label className="check-field">
                    <input
                      type="checkbox"
                      checked={form.postApproval === "true"}
                      onChange={(e) => set("postApproval", e.target.checked ? "true" : "")}
                    />
                    <span>
                      <strong>{tr("Le client valide ses publications")}</strong>
                      <small>{tr("Chaque publication programmée attend sa validation dans son portail avant de partir.")}</small>
                    </span>
                  </label>
                  <div className="form-pair">
                    <label className="form-field">
                      <span>{tr("Contenus vendus / mois")}</span>
                      <input
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={3}
                        value={form.quota || ""}
                        onChange={(e) =>
                          set("quota", e.target.value.replace(/\D/g, ""))
                        }
                        placeholder={tr("ex. 12")}
                      />
                      <small>
                        {tr("Sert au ratio « livré vs vendu » du pilotage.")}
                      </small>
                    </label>
                    <label className="form-field">
                      <span>{tr("Langue du portail")}</span>
                      <Pick
                        label={tr("Langue")}
                        value={form.language || "Français"}
                        onChange={(v) => set("language", v || "Français")}
                        items={["Français", "English", "العربية"]}
                      />
                    </label>
                  </div>
                  <label className="form-field">
                    <span>{tr("Dossier partagé")}</span>
                    <input
                      type="url"
                      value={form.drive || ""}
                      onChange={(e) => set("drive", e.target.value)}
                      placeholder="https://…"
                    />
                  </label>
                  <label className="form-field">
                    <span>{tr("Lien du contrat")}</span>
                    <input
                      type="url"
                      value={form.contract || ""}
                      onChange={(e) => set("contract", e.target.value)}
                      placeholder="https://…"
                    />
                  </label>
                </>
              )}
              {!memberTaskOnly && (
                <label className="form-field">
                  <span>
                    {tr(modal?.type === "client" ? "La marque" : "Description")}
                    {writable && (
                      <AiFix value={form.description || ""} kind="brief" workspaceId={workspace?.id} onChange={(v) => set("description", v)} />
                    )}
                  </span>
                  <textarea
                    rows={4}
                    maxLength={15000}
                    value={form.description || ""}
                    onChange={(e) => set("description", e.target.value)}
                    placeholder={tr("Objectifs, références et consignes…")}
                  />
                </label>
              )}

            </div>
          )}
          {formError && (
            <p role="alert" className="form-error">
              {formError}
            </p>
          )}
          <DialogFooter className="modal-footer">
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => setModal(null)}
            >
              {tr("Annuler")}
            </button>
            <button
              className={`btn primary ${modal?.type === "delete" ? "danger" : ""}`}
              disabled={busy}
            >
              {busy ? (
                <>
                  <Loader2 size={15} className="spin" />
                  {tr("Enregistrement…")}
                </>
              ) : (
                tr(
                  modal?.type === "delete"
                    ? "Supprimer définitivement"
                    : modal?.type === "archive"
                      ? modal.record?.archived
                        ? "Restaurer"
                        : "Archiver"
                      : modal?.type === "approve"
                        ? "Confirmer la validation"
                        : modal?.type === "internal-reject"
                          ? "Renvoyer avec la note"
                          : modal?.type === "feedback"
                          ? "Enregistrer les retours"
                          : modal?.record
                            ? "Enregistrer"
                            : modal?.type === "task"
                              ? "Créer la tâche"
                              : "Créer",
                )
              )}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** J−7 lock: an admin gets a confirmation instead of a dead end; lifting it is written in the history. */
export function LockPromptDialog({ editor, busy, mutate, navigate, setError, setNotice, setInlineTask }: {
  editor: RecordEditor;
  busy: boolean;
  mutate: (body: unknown) => Promise<WorkspacePayload>;
  navigate: StudioActions["navigate"];
  setError: (message: string) => void;
  setNotice: (message: string) => void;
  /** Clears the inline « new task » row once a task created there is saved. */
  setInlineTask: (task: null) => void;
}) {
  const lockDays = rulesOf(useProcess()).lockDays;
  const { t: tr } = useI18n();
  const { lockPrompt, setLockPrompt, setModal, setFormError } = editor;
  return (
    <Dialog
      open={!!lockPrompt}
      onOpenChange={(o) => {
        if (!o && !busy) setLockPrompt(null);
      }}
    >
      <DialogContent className="tracker-modal">
        <DialogHeader>
          <DialogTitle>
            {tr("Lever le verrou J−{n} ?", { n: lockDays })}
          </DialogTitle>
          <DialogDescription>
            {tr(
              "Le calendrier est gelé {days} jours avant chaque publication. Lever le verrou pour « {name} » ({date}) sera inscrit dans l’historique.",
              {
                days: lockDays,
                name: lockPrompt?.data?.name ?? "",
                date: lockPrompt?.data?.due ?? "",
              },
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="modal-footer">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => setLockPrompt(null)}
          >
            {tr("Annuler")}
          </button>
          <button
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              if (!lockPrompt) return;
              try {
                const r = await mutate({ ...lockPrompt, lockOverride: true });
                setLockPrompt(null);
                setModal(null);
                setFormError("");
                if (lockPrompt.action === "create" && lockPrompt.kind === "task") setInlineTask(null);
                setNotice(
                  tr(
                    lockPrompt.action === "create"
                      ? "Verrou levé · contenu créé"
                      : "Verrou levé · modification enregistrée",
                  ),
                );
                if (lockPrompt.action === "create" && r?.id)
                  navigate({ page: "task", id: r.id });
              } catch (e) {
                setError(tr((e as Error).message));
              }
            }}
          >
            <Unlock size={15} />
            {tr("Lever le verrou")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The studio's own fields for this task's work type (lib/process.ts FieldDef), each with the input its
 * type calls for. Values live in the form as « field:<id> » strings; the editor sends them as `fields`.
 */
function CustomFieldInputs({ defs, form, set, people }: {
  defs: FieldDef[];
  form: Record<string, string>;
  set: (key: string, value: string) => void;
  people: { userId: string; name?: string | null; email?: string | null }[];
}) {
  const { t: tr } = useI18n();
  if (!defs.length) return null;
  return (
    <div className="form-fields custom-fields">
      {defs.map((def) => {
        const key = `field:${def.id}`;
        const value = form[key] || "";
        const title = `${def.label}${def.unit ? ` (${def.unit})` : ""}`;
        const hint = def.client ? <small>{tr("Visible par le client")}</small> : null;
        if (def.type === "choice" || def.type === "person" || def.type === "platform") {
          const items = def.type === "choice" ? (def.options ?? []).map((o) => ({ value: o, label: o }))
            : def.type === "platform" ? requestPlatforms.map((p) => ({ value: p, label: tr(p) }))
            : people.map((p) => ({ value: p.userId, label: p.name || p.email || p.userId }));
          return (
            <label className="form-field" key={def.id}>
              <span>{title}</span>
              <Pick label={title} value={value} onChange={(v) => set(key, v || "")} items={items} />
              {hint}
            </label>
          );
        }
        if (def.type === "date") {
          return <label className="form-field" key={def.id}><DatePicker label={title} value={value} onChange={(v) => set(key, v)} />{hint}</label>;
        }
        if (def.type === "longtext") {
          return (
            <label className="form-field" key={def.id}>
              <span>{title}</span>
              <textarea rows={3} maxLength={5000} value={value} onChange={(e) => set(key, e.target.value)} dir="auto" />
              {hint}
            </label>
          );
        }
        const numeric = def.type === "number" || def.type === "money";
        return (
          <label className="form-field" key={def.id}>
            <span>{title}</span>
            <input
              type={numeric ? "number" : def.type === "link" ? "url" : "text"}
              inputMode={numeric ? "decimal" : undefined}
              step={def.type === "money" ? "0.01" : numeric ? "any" : undefined}
              min={def.type === "money" ? 0 : undefined}
              maxLength={numeric ? undefined : 500}
              placeholder={def.type === "link" ? "https://…" : undefined}
              value={value}
              onChange={(e) => set(key, e.target.value)}
              dir="auto"
            />
            {hint}
          </label>
        );
      })}
    </div>
  );
}
