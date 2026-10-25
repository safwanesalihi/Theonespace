// The studio's process (lib/process.ts): its statuses and pages, saved by the owner from « Personnaliser ».
// A status that is removed while tasks still use it needs a replacement: the answer names them, the
// next save carries the replacements, and the tasks move in the same transaction as the process.
import { stopClocks } from '@/lib/flow';
import type { RecordItem } from '@/lib/model';
import { processSchema, runsClock, statusLabel } from '@/lib/process';
import { loadProcessState, processKey } from '@/lib/process-server';
import type { ActionStep } from '../context';
import { response } from '../http';

export const saveProcess: ActionStep = {
  actions: ['process-save'],
  async run({ body, workspace, db, owner, rows, actor, now, result }) {
    if (workspace.role !== 'owner') return response({ error: 'Seul le propriétaire personnalise le processus du studio.' }, 403);
    const parsed = processSchema.safeParse(body.data);
    if (!parsed.success) return response({ error: parsed.error.issues[0]?.message || 'Processus invalide.' }, 400);
    if (!Number.isSafeInteger(body.revision) || body.revision < 0) return response({ error: 'Actualisez la page avant de réessayer.' }, 400);
    const next = parsed.data;
    const current = await loadProcessState(workspace.id, db);
    if (current.revision !== body.revision) return response({ error: 'Le processus a changé entre-temps. Actualisez la page avant de réessayer.' }, 409);

    // Statuses removed while tasks (or plan ideas) still use them: each needs one of the kept statuses.
    const kept = new Set(next.statuses.map((s) => s.id));
    const replacements = (typeof body.replacements === 'object' && body.replacements ? body.replacements : {}) as Record<string, unknown>;
    const stranded = rows.filter((r) => (r.kind === 'task' || r.kind === 'plan_item') && !!r.status && !kept.has(r.status));
    const missing = [...new Set(stranded.map((r) => r.status!))].filter((id) => typeof replacements[id] !== 'string' || !kept.has(replacements[id] as string));
    if (missing.length) {
      return response({
        error: 'Des tâches utilisent encore un statut supprimé : choisissez où les déplacer.', code: 'replace',
        statuses: missing.map((id) => ({ id, label: statusLabel(id, current.process), count: stranded.filter((r) => r.status === id).length })),
      }, 409);
    }

    const saved = await db.transaction(async (tx) => {
      const written = body.revision === 0
        ? await tx.query("INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ($1, $2, $3, 'meta', $4::jsonb, 1) ON CONFLICT (id) DO NOTHING RETURNING id", [processKey(workspace.id), owner, workspace.id, JSON.stringify(next)])
        : await tx.query("UPDATE records SET data = $1::jsonb, revision = revision + 1 WHERE id = $2 AND workspace_id = $3 AND kind = 'meta' AND revision = $4 RETURNING id", [JSON.stringify(next), processKey(workspace.id), workspace.id, body.revision]);
      if (!written.length) return false;
      for (const task of stranded) {
        const to = replacements[task.status!] as string;
        let moved: RecordItem = { ...task, status: to, history: [...(task.history ?? []), { text: `Statut remplacé : ${statusLabel(task.status, current.process)} → ${statusLabel(to, next)} (${actor})`, date: now }].slice(-100) };
        if (!runsClock(to, next)) moved = stopClocks(moved, now);
        const updated = await tx.query("UPDATE records SET data = $1::jsonb, revision = revision + 1 WHERE id = $2 AND workspace_id = $3 AND revision = $4 RETURNING id", [JSON.stringify(moved), task.id, workspace.id, task.revision]);
        if (!updated.length) throw new Error('changed');
      }
      return true;
    }).catch((error: Error) => { if (error.message === 'changed') return false; throw error; });
    if (!saved) return response({ error: 'Le processus ou une tâche a changé entre-temps. Actualisez la page avant de réessayer.' }, 409);
    return result({ moved: stranded.length });
  },
};
