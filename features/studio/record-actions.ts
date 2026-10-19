"use client";
// The studio's record actions shared by every screen: save changes to a record (saying what happened,
// starting the clock when a task moves to « En cours »), send an action, change a team member, and
// create the task typed in place.
import type { RecordItem } from "@/lib/model";
import type { WorkspaceRoute } from "@/lib/navigation";
import type { MemberChange } from "@/lib/workspace";
import type { InlineTask } from "@/features/tasks/use-task-list-view";
import type { Mutation, WorkspacePayload } from "@/features/workspace/use-workspace-session";
import { clean } from "./record-editor";

export function recordActions({ mutate, save, setBusy, setError, setNotice, navigate, inlineTask, setInlineTask, tr }: {
  mutate: (body: unknown) => Promise<WorkspacePayload>;
  /** A save with the J−7 lock check (features/studio/record-editor.tsx). */
  save: (body: Mutation) => Promise<WorkspacePayload>;
  setBusy: (busy: boolean) => void;
  setError: (message: string) => void;
  setNotice: (message: string) => void;
  navigate: (route: WorkspaceRoute) => void;
  inlineTask: InlineTask | null;
  setInlineTask: (task: InlineTask | null) => void;
  tr: (text: string, vars?: Record<string, string | number>) => string;
}) {
  async function changeMember(change: MemberChange) {
    const data = await mutate(change);
    setNotice(
      tr(
        change.action === "remove-member"
          ? "Accès retiré. Les contributions sont conservées."
          : change.action === "invite-member"
            ? data?.invitation?.sent
              ? "Invitation envoyée."
              : "Accès créé."
            : change.action === "renew-invitation"
              ? data?.invitation?.sent
                ? "Nouveau mot de passe temporaire envoyé."
                : "Nouveau mot de passe temporaire généré."
              : change.action === "set-member-whatsapp"
                ? "Numéro WhatsApp enregistré."
              : change.action === "set-member-titles"
                ? "Métiers mis à jour."
                : change.action === "set-print-access"
                  ? "Accès Impression mis à jour."
                  : "Rôle mis à jour.",
      ),
    );
    return data?.invitation;
  }
  async function update(
    r: RecordItem,
    changes: Partial<RecordItem>,
    message = tr("Modification enregistrée"),
  ) {
    try {
      const saved = await save({
        action: "update",
        id: r.id,
        kind: r.kind,
        revision: r.revision,
        data: { ...clean(r), ...changes },
      });
      setNotice(message);
      // Sending a task for approval can also message the client on WhatsApp; say what happened.
      if (saved?.whatsapp) {
        if (saved.whatsapp.sent) setNotice(tr("Envoyé en validation · WhatsApp accepté par Meta"));
        else setError(tr(saved.whatsapp.error || "L’envoi WhatsApp a échoué."));
      }

      if (saved?.assignmentWhatsapp?.sent) setNotice(tr("Assignation enregistrée · WhatsApp accepté par Meta"));

      if (changes.status && changes.status !== r.status) {
        // Leaving « En cours » stops every clock on the task server-side, as part of the save.
        if (changes.status === "En cours") {
          await act({ action: "start-timer", taskId: r.id }, tr("Chronomètre démarré"));
        } else if (changes.status === "En pause") {
          setNotice(tr("Tâche en pause · chronomètre arrêté"));
        } else if (changes.status === "Validation interne") {
          setNotice(tr("Envoyé en validation interne"));
        } else if (r.status === "En cours" && !saved?.whatsapp) {
          setNotice(tr("Chronomètre arrêté"));
        }
      }

      return true;
    } catch (e) {
      setError(tr((e as Error).message));
      return false;
    }
  }
  async function act(body: Mutation, message: string) {
    try {
      const result = await mutate(body);
      setNotice(message);
      if (result.whatsapp?.sent || result.assignmentWhatsapp?.sent) setNotice(tr("Notification WhatsApp acceptée par Meta"));
      return true;
    } catch (e) {
      setError(tr((e as Error).message));
      return false;
    }
  }
  async function submitInlineTask() {
    if (!inlineTask || !inlineTask.name?.trim()) {
      setInlineTask(null);
      return;
    }
    setBusy(true);
    try {
      const data: Record<string, unknown> = {
        name: inlineTask.name.trim(),
        clientId: inlineTask.clientId || "internal",
        projectId: inlineTask.projectId || "",
        priority: inlineTask.priority || "Moyenne",
        status: inlineTask.status || "À faire",
        assignee: inlineTask.assignee || "",
        due: inlineTask.due || "",
        evergreen: false,
        publishable: true,
      };
      const result = await save({ action: "create", kind: "task", id: crypto.randomUUID(), data });
      setInlineTask(null);
      setNotice(tr("Tâche ajoutée"));
      // Navigate to the new task so the user can fill in more details if needed
      if (result?.id) navigate({ page: "task", id: result.id });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }


  return { changeMember, update, act, submitInlineTask };
}
