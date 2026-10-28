// « Livrable validé » — the workspace owner hears by e-mail each time a task is approved: by the client,
// from the studio, or tacitly when the deadline passes. Silent when e-mail isn't set up, when nobody
// has an owner address, or when the owner approved it themselves.
import { database } from '@/lib/database';
import { env } from '@/lib/env';
import { mailConfigured, sendApprovalNotice } from '@/lib/mail';
import type { RecordItem } from '@/lib/model';
import { isDone, notifies, oneCoreProcess, type Process } from '@/lib/process';
import { taskWorkflowSettings } from '@/lib/workflow-settings';

export async function notifyOwnerOfApproval(workspaceId: string, task: RecordItem, origin: string, clientName?: string, process: Process = oneCoreProcess): Promise<void> {
  try {
    const signOff = task.signOff;
    // The agency's own work isn't a client approval; the studio may also switch this e-mail off.
    if (!mailConfigured() || !signOff || !isDone(task.status, process) || task.clientId === 'internal' || !notifies(process, 'approved', 'email')) return;
    const db = database();
    const owner = (await db.query<{ email: string | null }>(
      "SELECT COALESCE(m.email, u.email) AS email FROM workspace_members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1 AND m.role = 'owner' LIMIT 1", [workspaceId],
    ))[0]?.email;
    if (!owner) return;
    if (signOff.email && signOff.email.toLowerCase() === owner.toLowerCase()) return;
    const studio = (await db.query<{ name: string | null }>('SELECT name FROM workspaces WHERE id = $1', [workspaceId]))[0]?.name || 'The One Space';
    const base = (env.AUTH_URL ?? origin).replace(/\/$/, '');
    await sendApprovalNotice({
      to: owner, studio, taskName: task.name, clientName, mode: signOff.mode, by: signOff.by, at: signOff.at,
      hours: signOff.mode === 'silence' ? taskWorkflowSettings(task).validationHours : undefined,
      url: `${base}/#task/${encodeURIComponent(task.id)}`,
    });
  } catch (error) { console.error('approval notice', (error as Error).message); }
}
