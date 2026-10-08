"use client";
// A task's conversation inside the studio (side panel and task page): the WhatsApp-style chat, with
// the sender's role under each message, owner/admin deletion, and writing closed on archived work.
import { useI18n } from "@/lib/i18n/locale-provider";
import type { RecordItem } from "@/lib/model";
import { roleLabels } from "@/lib/workspace";
import type { StudioActions, StudioData, StudioLookups, StudioRoles } from "@/features/workspace/screen-props";
import TaskChat from "./task-chat";

export function TaskConversation({ task, data, roles, lookups, actions }: {
  task: RecordItem;
  data: Pick<StudioData, "records" | "workspace" | "user" | "members" | "busy">;
  roles: Pick<StudioRoles, "writable" | "manager">;
  lookups: Pick<StudioLookups, "archived">;
  actions: Pick<StudioActions, "mutate" | "setError">;
}) {
  const { t: tr } = useI18n();
  const { records, workspace, user, members, busy } = data;
  const { mutate, setError } = actions;
  return (
    <TaskChat
      key={task.id}
      taskId={task.id}
      messages={records.filter((r) => r.kind === "comment" && r.taskId === task.id)}
      workspaceId={workspace?.id}
      sender={{ id: user.id, name: user.name }}
      isMine={(c) => !!c.authorId && c.authorId === user.id}
      senderLabel={(c) => {
        if (c.audience === "client") return tr("Client");
        const role = members.find((m) => m.userId === c.authorId)?.role;
        return role ? tr(roleLabels[role]) : undefined;
      }}
      canWrite={roles.writable && !lookups.archived(task)}
      busy={busy}
      onSend={(message) => mutate({ action: "comment", taskId: task.id, ...message })}
      onDelete={roles.manager ? async (message) => { await mutate({ action: "comment-delete", id: message.id }); } : undefined}
      onError={setError}
    />
  );
}
