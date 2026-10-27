// The task conversation: messages (text, voice, files, mentions, replies), delivery and read receipts,
// and deletion by the owner and administrators.
import { after } from 'next/server';
import type { Statement } from '@/lib/database';
import { portalView } from '@/lib/flow';
import { insertRecord } from '@/lib/flow-server';
import type { Attachment, RecordItem } from '@/lib/model';
import { loadTaskThread } from '@/lib/task-chat-server';
import { taskMentionCandidates, validateMentions } from '@/lib/task-mentions';
import { notifies } from '@/lib/process';
import { messageNoticeConfigured, sendMessageNotice } from '@/lib/whatsapp';
import { isManager } from '@/lib/workspace';
import type { ActionContext, ActionStep } from '../context';
import { response } from '../http';
import { visibleTo } from '../payload';
import { one } from '../store';
import { members } from '../workspace-access';

/**
 * A voice message on a comment: an 'audio' asset this very user uploaded to this workspace.
 * Returns the id to store, null when none was sent, or an error message.
 */
export async function voiceMessage({ body, workspace, user }: ActionContext): Promise<string | null | { error: string }> {
  if (body.audio === undefined || body.audio === null || body.audio === '') return null;
  if (typeof body.audio !== 'string' || !/^[0-9a-f-]{36}$/.test(body.audio)) return { error: 'Message vocal invalide.' };
  const owned = await one<{ id: string }>(
    "SELECT id FROM assets WHERE id = $1 AND workspace_id = $2 AND kind = 'audio' AND created_by = $3",
    [body.audio, workspace.id, user.userId],
  );
  return owned ? body.audio : { error: 'Message vocal introuvable. Réenregistrez-le.' };
}

/**
 * Files in a message: 'file' assets this very user uploaded to this workspace, with the name they had
 * on the sender's device. Returns what to store on the comment, or an error message.
 */
async function messageFiles({ body, workspace, user, db }: ActionContext): Promise<Attachment[] | { error: string }> {
  if (body.attachments === undefined || body.attachments === null) return [];
  if (!Array.isArray(body.attachments) || body.attachments.length > 10) return { error: 'Jusqu’à 10 fichiers par message.' };
  const wanted = body.attachments as { id?: unknown; name?: unknown }[];
  if (!wanted.every((a) => a && typeof a.id === 'string' && /^[0-9a-f-]{36}$/.test(a.id))) return { error: 'Fichier invalide.' };
  const ids = [...new Set(wanted.map((a) => a.id as string))];
  const found = await db.query<{ id: string; content_type: string; size: number }>(
    "SELECT id, content_type, size FROM assets WHERE id = ANY($1::text[]) AND workspace_id = $2 AND kind = 'file' AND created_by = $3",
    [ids, workspace.id, user.userId],
  );
  if (found.length !== ids.length) return { error: 'Fichier introuvable. Joignez-le à nouveau.' };
  return ids.map((id) => {
    const row = found.find((f) => f.id === id)!;
    const raw = wanted.find((a) => a.id === id)?.name;
    const name = (typeof raw === 'string' ? raw : '').replace(/[\u0000-\u001f\\/]+/g, ' ').trim().slice(0, 120) || (row.content_type === 'application/pdf' ? 'document.pdf' : 'fichier');
    return { id, name, type: row.content_type, size: Number(row.size) };
  });
}

/** The task a conversation belongs to, as this person sees it; null when it (or a parent) is archived. */
function visibleTask(ctx: ActionContext, id: unknown) {
  const visible = visibleTo(ctx.workspace, ctx.rows, ctx.user);
  const task = visible.find((r) => r.id === id && (r.kind === 'task' || r.kind === 'plan_item'));
  if (!task || task.archived || ctx.rows.some((r) => (r.id === task.clientId || r.id === task.projectId) && r.archived)) return { visible, task: null };
  return { visible, task };
}

export const chatReceipt: ActionStep = {
  actions: ['chat-receipt'],
  async run(ctx) {
    const { body, workspace, user, db, now } = ctx;
    const { visible, task } = visibleTask(ctx, body.taskId);
    if (!task) return response({ error: 'Tâche introuvable.' }, 404);
    const validIds = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 200 && value.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 300);
    if (!validIds(body.delivered) || !validIds(body.seen)) return response({ error: 'Accusé de réception invalide.' }, 400);
    const delivered = [...new Set<string>([...body.delivered, ...body.seen])], seen = [...new Set<string>(body.seen)];
    if (delivered.some((id) => !visible.some((r) => r.kind === 'comment' && r.id === id && r.taskId === task.id))) return response({ error: 'Message introuvable.' }, 404);
    // A workspace viewer can browse a task without falsely acknowledging it for its actual people.
    if (!taskMentionCandidates(task, await members(workspace.id)).some((p) => p.userId === user.userId)) return response({ received: true });
    // Merge receipts atomically into the current JSON, never a stale comment snapshot. Self-reads,
    // tombstones and repeated acknowledgements cannot change a receipt or its server timestamp.
    await db.query(`UPDATE records SET data = data || jsonb_build_object('deliveredAt', COALESCE(data->>'deliveredAt', $5))
        || CASE WHEN id = ANY($4::text[]) THEN jsonb_build_object('seenAt', COALESCE(data->>'seenAt', GREATEST(data->>'deliveredAt', $5))) ELSE '{}'::jsonb END,
        revision = revision + 1
        WHERE workspace_id = $1 AND kind = 'comment' AND data->>'taskId' = $2 AND id = ANY($3::text[])
        AND data->>'authorId' IS DISTINCT FROM $6 AND NOT (data ? 'deletedAt')
        AND (NOT (data ? 'deliveredAt') OR (id = ANY($4::text[]) AND NOT (data ? 'seenAt')))`, [workspace.id, task.id, delivered, seen, now, user.userId]);
    return response({ received: true });
  },
};

export const comment: ActionStep = {
  actions: ['comment'],
  async run(ctx) {
    const { body, workspace, user, rows, db, owner, actor, now, findTask } = ctx;
    if (workspace.role === 'viewer') return response({ error: 'Votre rôle est en lecture seule.' }, 403);
    // A plan idea not yet sent to the tasks has a comment thread too (lib/content-plan-server.ts);
    // a client reaches it only once its plan is shared.
    const idea = findTask(body.taskId, 'plan_item');
    const task = findTask(body.taskId) ?? (idea && (workspace.role !== 'client' || idea.planShared) ? idea : null);
    if (!task) return response({ error: 'Tâche introuvable.' }, 404);
    if (workspace.role === 'client' && !portalView(rows, workspace.clientId!, user.userId).some((r) => r.id === task.id)) return response({ error: 'Tâche introuvable.' }, 404);
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    const people = body.mentions !== undefined ? taskMentionCandidates(task, await members(workspace.id)) : [];
    const mentions = validateMentions(body.mentions, text, people);
    if (!Array.isArray(mentions)) return response(mentions, 400);
    const voice = await voiceMessage(ctx);
    if (voice && typeof voice === 'object') return response(voice, 400);
    const files = await messageFiles(ctx);
    if (!Array.isArray(files)) return response(files, 400);
    // A reply quotes one earlier message of this same conversation, one the sender can see.
    let replyTo: string | undefined;
    if (body.replyTo !== undefined && body.replyTo !== null && body.replyTo !== '') {
      if (typeof body.replyTo !== 'string' || body.replyTo.length > 200) return response({ error: 'Message à citer introuvable.' }, 400);
      const quoted = visibleTo(workspace, rows, user).find((r) => r.kind === 'comment' && r.id === body.replyTo && r.taskId === task.id);
      if (!quoted) return response({ error: 'Message à citer introuvable.' }, 400);
      replyTo = quoted.id;
    }
    if ((!text && !voice && !files.length) || text.length > 5000) {
      return response({ error: 'Écrivez un message de 1 à 5 000 caractères, enregistrez un message vocal ou joignez un fichier.' }, 400);
    }
    if (body.submissionId !== undefined && (typeof body.submissionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.submissionId))) return response({ error: 'Identifiant de message invalide.' }, 400);
    const message: RecordItem = {
      id: body.submissionId ? `chat:${workspace.id}:${user.userId}:${body.submissionId}` : crypto.randomUUID(), kind: 'comment', revision: 1, name: text, taskId: task.id,
      clientId: task.clientId, author: actor, authorId: user.userId, createdAt: now,
      ...(voice ? { audio: voice } : {}),
      ...(files.length ? { attachments: files } : {}),
      ...(mentions.length ? { mentions } : {}),
      ...(replyTo ? { replyTo } : {}),
      ...(workspace.role === 'client' ? { audience: 'client' as const } : {}),
    };

    const reply = (saved: RecordItem) => ctx.compactComment
      ? response({ message: visibleTo(workspace, [...rows.filter((r) => r.id !== saved.id), saved], user).find((r) => r.id === saved.id) })
      : ctx.result();
    // A retried send (same submission id) is answered with the stored message — unless its content differs.
    const conflicts = (stored: RecordItem) => stored.taskId !== task.id || stored.authorId !== user.userId || (!stored.deletedAt && (
      stored.name !== message.name || stored.audio !== message.audio
      || JSON.stringify(stored.attachments ?? []) !== JSON.stringify(message.attachments ?? [])
      || JSON.stringify(stored.mentions ?? []) !== JSON.stringify(message.mentions ?? [])
      || stored.replyTo !== message.replyTo));
    const previous = rows.find((r) => r.id === message.id && r.kind === 'comment');
    if (previous) {
      if (conflicts(previous)) return response({ error: 'Ce message a déjà été envoyé avec un autre contenu.' }, 409);
      return reply(previous);
    }

    const statements: Statement[] = [insertRecord(message, owner, workspace.id)];

    // Who this comment is actually for: the task's assignee plus everyone who's already
    // commented on it — never the person who just wrote it.
    const priorAuthorIds = rows
      .filter((r): r is RecordItem & { authorId: string } => r.kind === 'comment' && r.taskId === task.id && !!r.authorId)
      .map((r) => r.authorId);
    // A client's message always reaches the studio's owner too: owner, client and assignee share the thread.
    const studioOwner = workspace.role === 'client'
      ? (await one<{ userId: string }>("SELECT user_id AS \"userId\" FROM workspace_members WHERE workspace_id = $1 AND role = 'owner'", [workspace.id]))?.userId
      : undefined;
    const mentionIds = [...new Set(mentions.map((m) => m.userId))].filter((id) => id !== user.userId);
    const recipients = [...new Set([task.assigneeId, studioOwner, ...priorAuthorIds].filter((id): id is string => !!id && id !== user.userId && !mentionIds.includes(id)))];
    const preview = text
      ? `${actor} a commenté : « ${text.substring(0, 30)}${text.length > 30 ? '...' : ''} » sur la tâche « ${task.name} ».`
      : files.length
        ? `${actor} a envoyé ${files.length > 1 ? `${files.length} fichiers` : `« ${files[0].name} »`} sur la tâche « ${task.name} ».`
        : `${actor} a laissé un message vocal sur la tâche « ${task.name} ».`;

    if (workspace.role === 'client') {
      // The client's own comment: notify studio, targeted at whoever's actually on this task.
      if (recipients.length) statements.push(insertRecord({
        id: `evt:${task.id}:comment:${message.id}`, kind: 'event', revision: 1, type: 'comment', audience: 'studio',
        name: preview, taskId: task.id, clientId: task.clientId, createdAt: now, recipients, readBy: [],
      }, 'system', workspace.id, true));
    } else {
      // The client still hears about every studio comment (unchanged, broadcast). Teammates on
      // this task now also get a targeted notification, which didn't exist before at all.
      statements.push(insertRecord({
        id: `evt:${task.id}:comment:${message.id}`, kind: 'event', revision: 1, type: 'comment', audience: 'client',
        name: preview, taskId: task.id, clientId: task.clientId, createdAt: now,
      }, 'system', workspace.id, true));
      if (recipients.length) statements.push(insertRecord({
        id: `evt:${task.id}:comment:studio:${message.id}`, kind: 'event', revision: 1, type: 'comment', audience: 'studio',
        name: preview, taskId: task.id, clientId: task.clientId, createdAt: now, recipients, readBy: [],
      }, 'system', workspace.id, true));
    }

    for (const recipient of mentionIds) {
      const person = people.find((p) => p.userId === recipient)!;
      statements.push(insertRecord({
        id: `evt:${task.id}:mention:${message.id}:${recipient}`, kind: 'event', revision: 1, type: 'comment',
        audience: person.role === 'client' ? 'client' : 'studio', recipients: [recipient], readBy: [],
        name: `${actor} vous a mentionné sur la tâche « ${task.name} ».`,
        taskId: task.id, clientId: task.clientId, createdAt: now,
      }, 'system', workspace.id, true));
    }

    const inserted = await db.transaction(async (tx) => {
      const first = insertRecord(message, owner, workspace.id, true);
      if (!(await tx.query(first.text + ' RETURNING id', first.params)).length) return false;
      for (const statement of statements.slice(1)) await tx.query(statement.text, statement.params);
      return true;
    });
    if (!inserted) {
      const stored = await loadTaskThread(workspace.id, task.id, workspace.clientId);
      const saved = stored.find((r) => r.id === message.id && r.kind === 'comment');
      if (!saved || conflicts(saved)) return response({ error: 'Ce message a déjà été envoyé avec un autre contenu.' }, 409);
      return reply(saved);
    }

    // The client hears on WhatsApp that the studio wrote to them (when the « nouveau message » template
    // is set up and their file has a number) — once per task every 2 hours, not at every message.
    if (workspace.role !== 'client' && messageNoticeConfigured() && notifies(ctx.studioProcess, 'message', 'whatsapp')) {
      const taskClient = rows.find((r) => r.kind === 'client' && r.id === task.clientId && !r.archived);
      const since = new Date(Date.now() - 2 * 3600_000).toISOString();
      const recent = rows.some((r) => r.kind === 'event' && r.type === 'whatsapp' && r.taskId === task.id && r.id.includes(':whatsapp-message:') && r.createdAt >= since && r.name.startsWith('WhatsApp envoyé'));
      if (taskClient?.whatsapp && !recent) {
        const url = ctx.signInUrl;
        after(async () => {
          try {
            // Recheck the cooldown: the compact send does not load the workspace's activity feed.
            const last = await db.query(`SELECT id FROM records WHERE workspace_id = $1 AND kind = 'event' AND data->>'taskId' = $2 AND data->>'type' = 'whatsapp' AND id LIKE '%:whatsapp-message:%' AND data->>'createdAt' >= $3 AND starts_with(data->>'name', 'WhatsApp envoyé') LIMIT 1`, [workspace.id, task.id, since]);
            if (last.length) return;
            const sent = await sendMessageNotice({ to: taskClient.whatsapp!, clientName: taskClient.name, from: actor, taskName: task.name, url });
            await ctx.insert({
              id: `evt:${task.id}:whatsapp-message:${message.id}`, kind: 'event', revision: 1, type: 'whatsapp', audience: 'studio',
              name: sent.sent ? `WhatsApp envoyé à ${taskClient.name} : nouveau message sur « ${task.name} ».` : `WhatsApp non envoyé à ${taskClient.name} pour le message sur « ${task.name} » — ${sent.error}`,
              taskId: task.id, clientId: taskClient.id, createdAt: new Date().toISOString(),
            }, true);
          } catch (error) { console.error('chat WhatsApp notice', error); }
        });
      }
    }
    return reply(message);
  },
};

/**
 * Deleting a message: the owner and admins only. The bubble stays, as « Message supprimé » with who
 * removed it and when, so the thread still reads right; its text, voice note and files are gone.
 */
export const commentDelete: ActionStep = {
  actions: ['comment-delete'],
  async run({ body, workspace, rows, db, actor, now, saveTask, result }) {
    if (!isManager(workspace.role)) return response({ error: 'Seuls le propriétaire et les administrateurs suppriment des messages.' }, 403);
    const message = rows.find((r) => r.kind === 'comment' && r.id === body.id);
    if (!message) return response({ error: 'Message introuvable.' }, 404);
    if (message.deletedAt) return result();
    const files = [message.audio, ...(message.attachments ?? []).map((a) => a.id)].filter((id): id is string => !!id);
    const { audio, attachments, mentions, ...kept } = message;
    void audio; void attachments; void mentions;
    if (!(await saveTask(message, { ...kept, name: '', deletedAt: now, deletedBy: actor }))) return response({ error: 'Ce message a changé. Actualisez avant de réessayer.' }, 409);
    if (files.length) await db.query("DELETE FROM assets WHERE workspace_id = $1 AND kind IN ('audio', 'file') AND id = ANY($2::text[])", [workspace.id, files]);
    // Notification events created for this message carry a preview of its text: redact it too.
    await db.query(
      "UPDATE records SET data = jsonb_set(data, '{name}', to_jsonb($3::text)) WHERE workspace_id = $1 AND kind = 'event' AND id LIKE 'evt:%' AND strpos(id, $2) > 0 AND (id LIKE '%:comment:%' OR id LIKE '%:mention:%' OR id LIKE '%:whatsapp-message:%')",
      [workspace.id, message.id, 'Message supprimé.'],
    );
    return result();
  },
};
