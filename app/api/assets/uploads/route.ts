// Large private chat files arrive in bounded chunks; no public bucket or extra configuration.
import { database } from '@/lib/database';
import { planRefusal } from '@/lib/subscription';
import { maxTaskFileBytes, taskFileType } from '@/lib/task-files';
import { taskUploadAccess, uploadJson as json } from '@/lib/task-file-upload';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const access = await taskUploadAccess(req);
  if (access instanceof Response) return access;
  const data = await req.json().catch(() => null);
  if (!data || typeof data.name !== 'string' || data.name.length > 255 || typeof data.type !== 'string' || data.type.length > 255 || !Number.isSafeInteger(data.size) || data.size <= 0 || data.size > maxTaskFileBytes) {
    return json({ error: 'Fichier vide ou trop lourd (100 Mo maximum).' }, 413);
  }
  const db = database(), id = crypto.randomUUID(), type = taskFileType(data.type, data.name);
  return db.transaction(async tx => {
    // Reserve the full size once, even while chunks are still arriving. Serialize reservations.
    await tx.query('SELECT id FROM workspaces WHERE id = $1 FOR UPDATE', [access.workspaceId]);
    await tx.query(`DELETE FROM assets WHERE workspace_id = $1 AND (id IN (
      SELECT id FROM assets WHERE workspace_id = $1 AND kind = 'file-upload' AND created_at < now() - interval '24 hours'
    ) OR (kind = 'file-chunk' AND split_part(id, ':', 1) IN (
      SELECT id FROM assets WHERE workspace_id = $1 AND kind = 'file-upload' AND created_at < now() - interval '24 hours'
    )))`, [access.workspaceId]);
    const refusal = await planRefusal(access.workspaceId, 'storageMb', data.size / 1_048_576, tx);
    if (refusal) return json(refusal, refusal.status);
    await tx.query('INSERT INTO assets (id, workspace_id, kind, content_type, size, bytes, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, access.workspaceId, 'file-upload', type, data.size, Buffer.alloc(0), access.userId]);
    return json({ id, type, size: data.size });
  });
}
