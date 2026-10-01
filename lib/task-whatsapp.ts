import { database } from '@/lib/database';
import { env } from '@/lib/env';
import { insertRecord } from '@/lib/flow-server';
import { memberWhatsappId } from '@/lib/member-whatsapp';
import type { RecordItem } from '@/lib/model';
import { memberName, type WorkspaceMember } from '@/lib/workspace';
import { sendApprovalRequest, sendAssignmentNotice, type WhatsappResult } from '@/lib/whatsapp';

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
  const result = client.whatsapp
    ? await sendApprovalRequest({ to: client.whatsapp, clientName: client.name, taskName: task.name, url: whatsappSignInUrl(origin) })
    : { sent: false, error: 'Ajoutez le numéro WhatsApp au format international dans la fiche du client.' };
  await log(workspaceId, task, result.sent
    ? `WhatsApp envoyé à Meta pour ${client.name} : « ${task.name} » est prêt à valider.`
    : `WhatsApp non envoyé à ${client.name} pour « ${task.name} » — ${result.error}`, 'approval', result);
  return result;
}

async function taskAssignment(workspaceId: string, task: RecordItem, previous: RecordItem | undefined, actorId: string, actor: string, origin: string): Promise<WhatsappResult | undefined> {
  if (!task.assigneeId || task.assigneeId === previous?.assigneeId || task.assigneeId === actorId || task.archived) return;
  const member = (await database().query<WorkspaceMember & { whatsapp?: string }>(
    `SELECT wm.user_id AS "userId", wm.role, COALESCE(NULLIF(wm.name, ''), u.name) AS name, wm.email, c.data->>'whatsapp' AS whatsapp
     FROM workspace_members wm LEFT JOIN users u ON u.id = wm.user_id
     LEFT JOIN records c ON c.workspace_id = wm.workspace_id AND c.kind = 'meta' AND c.id = $3
     WHERE wm.workspace_id = $1 AND wm.user_id = $2 AND wm.role <> 'client'`,
    [workspaceId, task.assigneeId, memberWhatsappId(workspaceId, task.assigneeId)],
  ))[0];
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
export const notifyTaskAssignment = (...args: Parameters<typeof taskAssignment>) => safely(() => taskAssignment(...args));
