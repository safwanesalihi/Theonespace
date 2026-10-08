// WhatsApp messages a manager sends on demand about a task: a reminder to its assignee, and a new try
// of the « à valider » notice. Each holds a 60-second lease so a double click sends once.
import { notifyTaskApproval, notifyTaskReminder } from '@/lib/task-whatsapp';
import { canManageMembers } from '@/lib/workspace';
import type { ActionStep } from '../context';
import { response } from '../http';
import { claimLease } from '../store';

const tooSoon = () => response({ error: 'Une demande WhatsApp vient d’être effectuée. Réessayez dans une minute.' }, 429);

export const remindAssigneeWhatsapp: ActionStep = {
  actions: ['remind-assignee-whatsapp'],
  async run({ body, workspace, db, owner, actor, origin, findTask, result }) {
    if (!canManageMembers(workspace.role)) return response({ error: 'Seuls les responsables peuvent envoyer un rappel à l’assigné.' }, 403);
    const task = findTask(body.taskId);
    if (!task) return response({ error: 'Tâche introuvable.' }, 404);
    if (task.status === 'Validé' || task.publishedAt) return response({ error: 'Cette tâche est terminée. Aucun rappel à envoyer.' }, 409);
    if (!task.assigneeId) return response({ error: 'Assignez cette tâche avant d’envoyer un rappel.' }, 409);
    if (body.revision !== task.revision) return response({ error: 'Cette tâche a changé. Actualisez avant de réessayer.' }, 409);
    if (!(await claimLease(db, `whatsapp-assignee-reminder:${task.id}`, owner, workspace.id))) return tooSoon();
    const whatsapp = await notifyTaskReminder(workspace.id, task, actor, origin);
    return result({ whatsapp });
  },
};

export const retryApprovalWhatsapp: ActionStep = {
  actions: ['retry-approval-whatsapp'],
  async run({ body, workspace, db, owner, rows, origin, findTask, result }) {
    if (!canManageMembers(workspace.role)) return response({ error: 'Seuls les responsables peuvent renvoyer cette notification.' }, 403);
    const task = findTask(body.taskId);
    if (!task || task.status !== 'À valider') return response({ error: 'Cette tâche n’est plus en attente de validation.' }, 409);
    if (body.revision !== task.revision) return response({ error: 'Cette tâche a changé. Actualisez avant de réessayer.' }, 409);
    // Atomic lease: double-clicks and concurrent requests send at most once in 60 seconds.
    if (!(await claimLease(db, `whatsapp-retry:${task.id}`, owner, workspace.id))) return tooSoon();
    const whatsapp = await notifyTaskApproval(workspace.id, task, rows, origin);
    return result({ whatsapp });
  },
};
