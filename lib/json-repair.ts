// Until the fix in lib/database.ts, production stored every record's data as a JSON *string* holding
// the object. This turns those rows back into the objects they contain. It runs on each server
// instance's first connection and finds nothing to do once done.
import type { Db } from '@/lib/database';
import { nextDocNumber } from '@/lib/documents';
import type { DocType } from '@/lib/model';

type Doc = { id: string; workspaceId: string; data: Record<string, unknown> & { docType: DocType; number?: string; createdAt?: string; history?: { text: string; date: string }[] } };

export async function repairJsonRows(db: Db, now = new Date().toISOString()) {
  const rows = await db.query<{ id: string }>(
    "UPDATE records SET data = (data #>> '{}')::jsonb WHERE jsonb_typeof(data) = 'string' AND kind <> 'document' RETURNING id",
  );

  // Documents one at a time, oldest first: their number is unique per workspace, type and year as soon
  // as it is readable, and the bug gave every document of a type and year the same number. The oldest
  // keeps it; each later one gets the next free number, and its history keeps the old one.
  const stored = await db.query<{ id: string; workspace_id: string; text: string }>(
    "SELECT id, workspace_id, data #>> '{}' AS text FROM records WHERE kind = 'document' AND jsonb_typeof(data) = 'string'",
  );
  const docs: Doc[] = stored
    .map((r) => ({ id: r.id, workspaceId: r.workspace_id, data: JSON.parse(r.text) }))
    .sort((a, b) => String(a.data.createdAt ?? '').localeCompare(String(b.data.createdAt ?? '')));
  const renumbered: string[] = [];
  for (const doc of docs) {
    try {
      const { data } = doc;
      const old = data.number;
      const taken = old ? await db.query(
        "SELECT 1 FROM records WHERE workspace_id = $1 AND kind = 'document' AND data->>'docType' = $2 AND data->>'number' = $3 AND id <> $4",
        [doc.workspaceId, data.docType, old, doc.id],
      ) : [];
      if (old && taken.length) {
        const readable = await db.query<{ number: string }>(
          "SELECT data->>'number' AS number FROM records WHERE workspace_id = $1 AND kind = 'document' AND data->>'docType' = $2 AND data->>'number' IS NOT NULL",
          [doc.workspaceId, data.docType],
        );
        const pending = docs.filter((d) => d.workspaceId === doc.workspaceId && d.data.docType === data.docType).map((d) => d.data.number ?? '');
        const year = Number(/-(\d{4})-/.exec(old)?.[1]) || new Date(data.createdAt ?? now).getFullYear();
        const { seq, number } = nextDocNumber([...readable.map((r) => r.number), ...pending], data.docType, year);
        if (data.name === old) data.name = number;
        Object.assign(data, { number, seq, history: [...(data.history ?? []), { text: `Numéro corrigé : ${old} → ${number} (doublon)`, date: now }] });
        renumbered.push(`${old} → ${number}`);
      }
      await db.query("UPDATE records SET data = $1::jsonb WHERE id = $2 AND jsonb_typeof(data) = 'string'", [JSON.stringify(data), doc.id]);
    } catch (error) {
      console.error('repair json rows: document', doc.id, (error as Error).message);
    }
  }
  if (rows.length || docs.length) {
    console.info(`repair json rows: ${rows.length} records, ${docs.length} documents${renumbered.length ? `, renumbered ${renumbered.join(', ')}` : ''}`);
  }
  return { records: rows.length, documents: docs.length, renumbered };
}
