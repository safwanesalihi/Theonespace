import { database } from '@/lib/database';
import { env } from '@/lib/env';
import { insertRecord } from '@/lib/flow-server';
import { memberWhatsappId } from '@/lib/member-whatsapp';
import { notifies, type NotifyEvent } from '@/lib/process';
import { loadProcess } from '@/lib/process-server';
import type { RecordItem } from '@/lib/model';
import { memberName, type WorkspaceMember } from '@/lib/workspace';
import { sendApprovalRequest, sendApprovedNotice, sendAssignmentNotice, sendChangesNotice, sendReminderNotice, type WhatsappResult } from '@/lib/whatsapp';

/** Whether the studio sends this automatic WhatsApp message (lib/process.ts notifications; on by default). */
const studioSends = async (workspaceId: string, event: NotifyEvent) => notifies(await loadProcess(workspaceId), event, 'whatsapp');

export const whatsappSignInUrl = (origin: string) => `${(env.AUTH_URL || origin).replace(/\/$/, '')}/login`;

async function log(workspaceId: string, task: RecordItem, name: string, purpose: string, result: WhatsappResult) {
  const event: RecordItem = {
    id: `evt:${task.id}:whatsapp-${purpose}:${crypto.randomUUID()}`, kind: 'event', revision: 1,
    type: 'whatsapp', audience: 'studio', taskId: task.id, clientId: task.clientId,
    name, createdAt: new Date().toISOString(),
    whatsappMessageId: result.messageId,
  };
  const statement = insertRecord(event, 'system', workspaceId, true);
  // An audit write failure must not turn a successful task save into a failed save.
  await database().query(statement.text, statement.params).catch(error => console.error('whatsapp audit', error.message));
}

async function taskApproval(workspaceId: string, task: RecordItem, rows: RecordItem[], origin: string): Promise<WhatsappResult | undefined> {
  const client = rows.find(r => r.kind === 'client' && r.id === task.clientId && !r.archived);
  if (!client || task.archived) return;
  if (!(await studioSends(workspaceId, 'sent'))) return;
  const result = client.whatsapp
    ? await sendApprovalRequest({ to: client.whatsapp, clientName: client.name, taskName: task.name, url: whatsappSignInUrl(origin) })
    : { sent: false, error: 'Ajoutez le numéro WhatsApp dans la fiche du client.' };
  await log(workspaceId, task, result.sent
    ? `WhatsApp envoyé à Meta pour ${client.name} : « ${task.name} » est prêt à valider.`
    : `WhatsApp non envoyé à ${client.name} pour « ${task.name} » — ${result.error}`, 'approval', result);
  return result;
}

async function assigneeContact(workspaceId: string, task: RecordItem) {
  if (!task.assigneeId) return;
  return (await database().query<WorkspaceMember & { whatsapp?: string }>(
    `SELECT wm.user_id AS "userId", wm.role, COALESCE(NULLIF(wm.name, ''), u.name) AS name, wm.email, c.data->>'whatsapp' AS whatsapp
     FROM workspace_members wm LEFT JOIN users u ON u.id = wm.user_id
     LEFT JOIN records c ON c.workspace_id = wm.workspace_id AND c.kind = 'meta' AND c.id = $3
     WHERE wm.workspace_id = $1 AND wm.user_id = $2 AND wm.role NOT IN ('client', 'viewer')`,
    [workspaceId, task.assigneeId, memberWhatsappId(workspaceId, task.assigneeId)],
  ))[0];
}

async function taskAssignment(workspaceId: string, task: RecordItem, previous: RecordItem | undefined, actorId: string, actor: string, origin: string): Promise<WhatsappResult | undefined> {
  if (!task.assigneeId || task.assigneeId === previous?.assigneeId || task.assigneeId === actorId || task.archived) return;
  if (!(await studioSends(workspaceId, 'assigned'))) return;
  const member = await assigneeContact(workspaceId, task);
  if (!member) return;
  // Workspaces that have not enabled assignment alerts keep their usual task flow.
  if (!member.whatsapp && !env.WHATSAPP_ASSIGNMENT_TEMPLATE) return;
  const result = member.whatsapp
    ? await sendAssignmentNotice({ to: member.whatsapp, memberName: memberName(member), taskName: task.name, from: actor, url: whatsappSignInUrl(origin) })
    : { sent: false, error: `Ajoutez le numéro WhatsApp de ${memberName(member)} dans Équipe.` };
  await log(workspaceId, task, result.sent
    ? `WhatsApp envoyé à Meta pour ${memberName(member)} : « ${task.name} » vous a été assignée.`
    : `WhatsApp non envoyé à ${memberName(member)} pour l’assignation de « ${task.name} » — ${result.error}`, 'assignment', result);
  return result;
}

async function taskAssigneeNotice(workspaceId: string, task: RecordItem, contextName: string, origin: string, purpose: 'changes' | 'reminder'): Promise<WhatsappResult> {
  // The client's changes alert follows the studio's choice; a reminder is a click, always sent.
  if (purpose === 'changes' && !(await studioSends(workspaceId, 'changes'))) return { sent: false, error: 'Message désactivé par le studio.' };
  const member = await assigneeContact(workspaceId, task);
  const name = member ? memberName(member) : 'l’assigné';
  const result: WhatsappResult = !member
    ? { sent: false, error: 'Cette tâche n’a pas d’assigné actif dans l’équipe.' }
    : !member.whatsapp
      ? { sent: false, error: `Ajoutez le numéro WhatsApp de ${name} dans Équipe.` }
      : purpose === 'changes'
        ? await sendChangesNotice({ to: member.whatsapp, memberName: name, taskName: task.name, clientName: contextName, url: whatsappSignInUrl(origin) })
        : await sendReminderNotice({ to: member.whatsapp, memberName: name, taskName: task.name, from: contextName, url: whatsappSignInUrl(origin) });
  const subject = purpose === 'changes' ? 'les modifications du client' : 'le rappel de tâche';
  await log(workspaceId, task, result.sent
    ? `WhatsApp envoyé à Meta pour ${name} : ${subject} pour « ${task.name} ».`
    : `WhatsApp non envoyé à ${name} pour ${subject} sur « ${task.name} » — ${result.error}`, purpose, result);
  return result;
}

/** The owner and the admins who have a WhatsApp number — who hears when the client approves a task. */
async function approvalRecipients(workspaceId: string) {
  return database().query<WorkspaceMember & { whatsapp?: string }>(
    `SELECT wm.user_id AS "userId", wm.role, COALESCE(NULLIF(wm.name, ''), u.name) AS name, wm.email, c.data->>'whatsapp' AS whatsapp
     FROM workspace_members wm LEFT JOIN users u ON u.id = wm.user_id
     LEFT JOIN records c ON c.workspace_id = wm.workspace_id AND c.kind = 'meta' AND c.id = 'whatsapp:' || wm.workspace_id || ':' || wm.user_id
     WHERE wm.workspace_id = $1 AND wm.role IN ('owner', 'admin') ORDER BY wm.role, wm.created_at`, [workspaceId],
  );
}

// The client approved a task: the owner and each admin hear it on WhatsApp (when that template is set up
// and they have a number in Équipe). One person's failure never stops the others.
async function taskApprovedByClient(workspaceId: string, task: RecordItem, clientName: string, origin: string): Promise<WhatsappResult | undefined> {
  if (!env.WHATSAPP_APPROVED_TEMPLATE?.trim() || task.archived || task.signOff?.mode !== 'explicit') return;
  if (!(await studioSends(workspaceId, 'approved'))) return;
  let last: WhatsappResult | undefined;
  for (const person of await approvalRecipients(workspaceId)) {
    if (!person.whatsapp) continue;
    const name = memberName(person);
    const result = await sendApprovedNotice({ to: person.whatsapp, memberName: name, taskName: task.name, clientName, url: whatsappSignInUrl(origin) })
      .catch((): WhatsappResult => ({ sent: false, error: 'Envoi WhatsApp impossible.' }));
    await log(workspaceId, task, result.sent
      ? `WhatsApp envoyé à Meta pour ${name} : ${clientName} a validé « ${task.name} ».`
      : `WhatsApp non envoyé à ${name} pour la validation de « ${task.name} » — ${result.error}`, 'approved', result);
    last = result;
  }
  return last;
}

// These run after a task commit. Even a contact/audit database failure must never
// tell the caller its task was not saved, or tempt them to create it twice.
async function safely(send: () => Promise<WhatsappResult | undefined>) {
  try { return await send(); }
  catch (error) {
    console.error('whatsapp notification', error instanceof Error ? error.message : 'unknown');
    return { sent: false, error: 'La tâche est enregistrée, mais sa notification WhatsApp a échoué. Réessayez depuis la tâche.' };
  }
}
export const notifyTaskApproval = (...args: Parameters<typeof taskApproval>) => safely(() => taskApproval(...args));
export const notifyTaskApprovedByClient = (...args: Parameters<typeof taskApprovedByClient>) => safely(() => taskApprovedByClient(...args));
export const notifyTaskAssignment = (...args: Parameters<typeof taskAssignment>) => safely(() => taskAssignment(...args));
export const notifyTaskChanges = (workspaceId: string, task: RecordItem, clientName: string, origin: string) => safely(() => taskAssigneeNotice(workspaceId, task, clientName, origin, 'changes'));
export const notifyTaskReminder = (workspaceId: string, task: RecordItem, actor: string, origin: string) => safely(() => taskAssigneeNotice(workspaceId, task, actor, origin, 'reminder'));
