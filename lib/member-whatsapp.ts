import { database } from '@/lib/database';

// Workspace contacts are private metadata, like member titles. Existing databases
// already support it; no production schema migration is needed.
export const memberWhatsappId = (workspaceId: string, userId: string) => `whatsapp:${workspaceId}:${userId}`;

export async function storeMemberWhatsapp(workspaceId: string, userId: string, whatsapp: string, actor: string) {
  const id = memberWhatsappId(workspaceId, userId);
  if (!whatsapp) {
    await database().query("DELETE FROM records WHERE id = $1 AND workspace_id = $2 AND kind = 'meta'", [id, workspaceId]);
    return;
  }
  await database().query(
    `INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ($1, $2, $3, 'meta', $4::jsonb, 1)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, revision = records.revision + 1 WHERE records.workspace_id = EXCLUDED.workspace_id`,
    [id, actor, workspaceId, JSON.stringify({ userId, whatsapp })],
  );
}
