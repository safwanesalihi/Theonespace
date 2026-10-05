import { database, type Db } from '@/lib/database';
import { taskFileChunkBytes } from '@/lib/task-files';
import { taskUploadAccess, uploadJson as json } from '@/lib/task-file-upload';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
type Context = { params: Promise<{ id: string }> };
type Upload = { kind: string; size: number; content_type: string; expired: boolean };
async function ownUpload(tx: Db, id: string, access: { workspaceId: string; userId: string }) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return undefined;
  return (await tx.query<Upload>(`SELECT kind, size, content_type, created_at < now() - interval '24 hours' AS expired
    FROM assets WHERE id = $1 AND workspace_id = $2 AND created_by = $3 AND kind IN ('file-upload', 'file') FOR UPDATE`,
  [id, access.workspaceId, access.userId]))[0];
}

export async function PUT(req: Request, context: Context) {
  const access = await taskUploadAccess(req);
  if (access instanceof Response) return access;
  const { id } = await context.params, part = new URL(req.url).searchParams.get('part');
  if (!part || !/^(0|[1-9]\d?)$/.test(part)) return json({ error: 'Envoi invalide.' }, 400);
  // Bound the body while reading too, rather than trusting Content-Length.
  const reader = req.body?.getReader(), buffers: Uint8Array[] = [];
  if (!reader) return json({ error: 'Aucun fichier reçu.' }, 400);
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > taskFileChunkBytes) { await reader.cancel(); return json({ error: 'Envoi trop lourd.' }, 413); }
      buffers.push(next.value);
    }
  } catch { return json({ error: 'Envoi interrompu.' }, 400); }
  const bytes = Buffer.concat(buffers);
  return database().transaction(async tx => {
    const row = await ownUpload(tx, id, access);
    if (!row || row.kind !== 'file-upload') return json({ error: 'Fichier introuvable. Joignez-le à nouveau.' }, 404);
    if (row.expired) return json({ error: 'Envoi expiré. Joignez le fichier à nouveau.' }, 410);
    const index = Number(part), expected = Math.min(taskFileChunkBytes, row.size - index * taskFileChunkBytes);
    if (expected <= 0 || size !== expected) return json({ error: 'Envoi incomplet. Joignez le fichier à nouveau.' }, 400);
    const chunkId = `${id}:${index}`;
    const previous = (await tx.query<{ same: boolean }>('SELECT bytes = $2::bytea AS same FROM assets WHERE id = $1', [chunkId, bytes]))[0];
    if (previous) return previous.same ? json({ ok: true }) : json({ error: 'Envoi invalide.' }, 409);
    await tx.query('INSERT INTO assets (id, workspace_id, kind, content_type, size, bytes, created_by) VALUES ($1, $2, $3, $4, 0, $5, $6)',
      [chunkId, access.workspaceId, 'file-chunk', 'application/octet-stream', bytes, access.userId]);
    return json({ ok: true });
  });
}

export async function POST(req: Request, context: Context) {
  const access = await taskUploadAccess(req);
  if (access instanceof Response) return access;
  const { id } = await context.params;
  return database().transaction(async tx => {
    const row = await ownUpload(tx, id, access);
    if (!row) return json({ error: 'Fichier introuvable. Joignez-le à nouveau.' }, 404);
    if (row.kind === 'file') return json({ id, type: row.content_type, size: row.size });
    if (row.expired) return json({ error: 'Envoi expiré. Joignez le fichier à nouveau.' }, 410);
    const parts = (await tx.query<{ n: number; size: string }>(`SELECT count(*)::int AS n, coalesce(sum(octet_length(bytes)), 0) AS size
      FROM assets WHERE kind = 'file-chunk' AND workspace_id = $2 AND split_part(id, ':', 1) = $1`, [id, access.workspaceId]))[0];
    if (parts.n !== Math.ceil(row.size / taskFileChunkBytes) || Number(parts.size) !== row.size) return json({ error: 'Envoi incomplet. Joignez le fichier à nouveau.' }, 409);
    if (row.content_type === 'application/pdf') {
      const first = (await tx.query<{ valid: boolean }>("SELECT substring(bytes from 1 for 5) = $2::bytea AS valid FROM assets WHERE id = $1", [`${id}:0`, Buffer.from('%PDF-')]))[0];
      if (!first?.valid) return json({ error: 'Ce fichier n’est pas un PDF valide.' }, 415);
    }
    // Assemble inside Postgres: the function never loads a 100 MB file into JavaScript memory.
    await tx.query(`UPDATE assets SET bytes = (
      SELECT string_agg(bytes, ''::bytea ORDER BY split_part(id, ':', 2)::int) FROM assets
      WHERE kind = 'file-chunk' AND workspace_id = $2 AND split_part(id, ':', 1) = $1
    ), kind = 'file' WHERE id = $1`, [id, access.workspaceId]);
    await tx.query("DELETE FROM assets WHERE kind = 'file-chunk' AND workspace_id = $2 AND split_part(id, ':', 1) = $1", [id, access.workspaceId]);
    return json({ id, type: row.content_type, size: row.size });
  });
}

export async function DELETE(req: Request, context: Context) {
  const access = await taskUploadAccess(req);
  if (access instanceof Response) return access;
  const { id } = await context.params;
  return database().transaction(async tx => {
    const row = await ownUpload(tx, id, access);
    if (row?.kind === 'file-upload') {
      await tx.query("DELETE FROM assets WHERE id = $1 OR (kind = 'file-chunk' AND split_part(id, ':', 1) = $1)", [id]);
    }
    return json({ ok: true });
  });
}
