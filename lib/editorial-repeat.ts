// The scheduled run's side of repeating posts (rules in lib/social-repeat.ts): for each series whose
// time has come, one transaction moves the series to its next date and creates that day's copy — only
// the run whose write lands on the series' revision does it, and a copy's id is the series' id and its
// day, so two runs at the same minute can never post a day twice. The copy is then published by the
// same run like any scheduled post.
import { database } from '@/lib/database';
import { insertRecord } from '@/lib/flow-server';
import type { RecordItem } from '@/lib/model';
import { awaitingClient } from '@/lib/social';
import { seriesStep } from '@/lib/social-repeat';

/** Series ready to go: scheduled, repeating, approved when the client approves posts. */
export function liveSeries(records: RecordItem[]) {
  const clients = new Map(records.filter((r) => r.kind === 'client').map((r) => [r.id, r]));
  return records.filter((post) => {
    if (post.kind !== 'editorial_post' || !post.repeat || post.archived || post.publishedAt || post.socialState !== 'scheduled') return false;
    const client = post.clientId ? clients.get(post.clientId) : undefined;
    return !client?.archived && !awaitingClient(post, client) && post.approval?.state !== 'changes';
  });
}

/** The copy of a series for one day: its content, its approval, none of its files (they stay the series'). */
export function occurrenceOf(series: RecordItem, day: string, now: Date): RecordItem {
  const nowIso = now.toISOString();
  return {
    id: `${series.id}@${day}`, kind: 'editorial_post', revision: 1, repeatOf: series.id,
    name: series.name, clientId: series.clientId, description: series.description, due: day, time: series.time,
    targets: series.targets ?? [], channels: series.channels ?? [], ...(series.postType ? { postType: series.postType } : {}),
    // Without `path`: deleting this copy must never delete the series' photos and videos.
    media: (series.media ?? []).map(({ path, ...m }) => { void path; return m; }),
    socialState: 'scheduled', ...(series.approval ? { approval: series.approval } : {}),
    author: series.author, createdAt: nowIso,
    history: [{ text: `Publication du ${day}, de la série « ${series.name} »`, date: nowIso }],
  };
}

/** Moves every due series on and creates the day's copies. Returns the ids of the copies created. */
export async function advanceSeries(workspaceId: string, records: RecordItem[], now = new Date()): Promise<string[]> {
  const db = database();
  const created: string[] = [];
  const nowIso = now.toISOString();
  for (const series of liveSeries(records)) {
    const step = seriesStep(series, now);
    if (!step) continue;
    const history = [
      ...step.skipped.map((day) => ({ text: `Publication du ${day} sautée (l’envoi automatique n’a pas tourné à temps)`, date: nowIso })),
      ...(step.publish ? [{ text: `Publication du ${step.publish} lancée`, date: nowIso }] : []),
      ...(step.next ? [] : [{ text: 'Série terminée', date: nowIso }]),
    ];
    // A series with no date left ends: it shows as published, and leaves every queue.
    const patch = step.next ? { due: step.next } : { publishedAt: nowIso };
    const made = await db.transaction(async (tx) => {
      const moved = await tx.query<{ owner: string }>(
        `UPDATE records SET data = jsonb_set(data || $1::jsonb, '{history}', (COALESCE(data->'history', '[]'::jsonb) || $2::jsonb)), revision = revision + 1
         WHERE id = $3 AND workspace_id = $4 AND revision = $5 RETURNING owner`,
        [JSON.stringify(patch), JSON.stringify(history), series.id, workspaceId, series.revision],
      );
      if (!moved.length) return null; // another run got there first
      if (!step.publish) return null;
      const copy = occurrenceOf(series, step.publish, now);
      const insert = insertRecord(copy, moved[0].owner, workspaceId, true);
      const rows = await tx.query(`${insert.text} RETURNING id`, insert.params);
      return rows.length ? copy.id : null;
    });
    if (made) created.push(made);
  }
  return created;
}
