// The studio's process (lib/process.ts): its statuses and pages, saved by the owner from « Personnaliser ».
// A status or a work type removed while tasks still use it needs a replacement: the answer names them,
// the next save carries the replacements, and the tasks move in the same transaction as the process.
// A task whose path no longer holds its status (a path edited, a type changed) takes the nearest step of
// its path: the same kind of step, else its start (lib/process.ts statusInFlow).
import { stopClocks } from '@/lib/flow';
import type { RecordItem } from '@/lib/model';
import { processSchema, runsClock, statusInFlow, statusLabel, workTypeOf } from '@/lib/process';
import { loadProcessState, processKey } from '@/lib/process-server';
import type { ActionStep } from '../context';
import { response } from '../http';

const asMap = (value: unknown) => (typeof value === 'object' && value ? value : {}) as Record<string, unknown>;

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

    const work = rows.filter((r) => r.kind === 'task' || r.kind === 'plan_item');
    // Statuses removed while tasks (or plan ideas) still use them: each needs one of the kept statuses.
    const kept = new Set(next.statuses.map((s) => s.id));
    const replacements = asMap(body.replacements);
    const strandedStatus = work.filter((r) => !!r.status && !kept.has(r.status));
    const missing = [...new Set(strandedStatus.map((r) => r.status!))].filter((id) => typeof replacements[id] !== 'string' || !kept.has(replacements[id] as string));
    // Work types removed while tasks still use them: each needs one of the kept types (none left: the
    // tasks simply follow the studio's single path).
    const keptTypes = new Set((next.workTypes ?? []).map((w) => w.id));
    const typeReplacements = asMap(body.typeReplacements);
    const strandedType = keptTypes.size ? work.filter((r) => !!r.workType && !keptTypes.has(r.workType)) : [];
    const missingTypes = [...new Set(strandedType.map((r) => r.workType!))].filter((id) => typeof typeReplacements[id] !== 'string' || !keptTypes.has(typeReplacements[id] as string));
    if (missing.length || missingTypes.length) {
      return response({
        error: 'Des tâches utilisent encore un statut ou un type de travail supprimé : choisissez où les déplacer.', code: 'replace',
        statuses: missing.map((id) => ({ id, label: statusLabel(id, current.process), count: strandedStatus.filter((r) => r.status === id).length })),
        types: missingTypes.map((id) => ({ id, label: current.process.workTypes?.find((w) => w.id === id)?.label ?? id, count: strandedType.filter((r) => r.workType === id).length })),
      }, 409);
    }

    // Every task the new process changes: its status replaced, its type replaced or dropped, or its path
    // no longer holding its status.
    const moves: { task: RecordItem; moved: RecordItem }[] = [];
    for (const task of work) {
      const notes: string[] = [];
      let status = task.status, workType = task.workType;
      if (status && !kept.has(status)) {
        const to = replacements[status] as string;
        notes.push(`Statut remplacé : ${statusLabel(status, current.process)} → ${statusLabel(to, next)}`);
        status = to;
      }
      if (workType && !keptTypes.has(workType)) {
        const to = keptTypes.size ? typeReplacements[workType] as string : undefined;
        const from = current.process.workTypes?.find((w) => w.id === workType)?.label ?? workType;
        notes.push(to ? `Type de travail remplacé : ${from} → ${workTypeOf(next, to)?.label ?? to}` : `Type de travail retiré : ${from}`);
        workType = to;
      }
      const fitted = status && task.kind === 'task' ? statusInFlow(next, status, workType) : status;
      if (fitted !== status) { notes.push(`Statut ajusté au chemin : ${statusLabel(status, next)} → ${statusLabel(fitted, next)}`); status = fitted; }
      if (!notes.length) continue;
      let moved: RecordItem = { ...task, status, history: [...(task.history ?? []), ...notes.map((text) => ({ text: `${text} (${actor})`, date: now }))].slice(-100) };
      if (workType) moved.workType = workType; else delete moved.workType;
      if (status !== task.status && !runsClock(status, next)) moved = stopClocks(moved, now);
      moves.push({ task, moved });
    }

    const saved = await db.transaction(async (tx) => {
      const written = body.revision === 0
        ? await tx.query("INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ($1, $2, $3, 'meta', $4::jsonb, 1) ON CONFLICT (id) DO NOTHING RETURNING id", [processKey(workspace.id), owner, workspace.id, JSON.stringify(next)])
        : await tx.query("UPDATE records SET data = $1::jsonb, revision = revision + 1 WHERE id = $2 AND workspace_id = $3 AND kind = 'meta' AND revision = $4 RETURNING id", [JSON.stringify(next), processKey(workspace.id), workspace.id, body.revision]);
      if (!written.length) return false;
      for (const { task, moved } of moves) {
        const updated = await tx.query("UPDATE records SET data = $1::jsonb, revision = revision + 1 WHERE id = $2 AND workspace_id = $3 AND revision = $4 RETURNING id", [JSON.stringify(moved), task.id, workspace.id, task.revision]);
        if (!updated.length) throw new Error('changed');
      }
      return true;
    }).catch((error: Error) => { if (error.message === 'changed') return false; throw error; });
    if (!saved) return response({ error: 'Le processus ou une tâche a changé entre-temps. Actualisez la page avant de réessayer.' }, 409);
    return result({ moved: moves.length });
  },
};
