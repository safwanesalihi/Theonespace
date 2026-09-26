// Serves an upload to signed-in members of its workspace (profile pictures to any signed-in user). Ids are unique per upload, so responses cache forever.
import { getAppUser } from '@/lib/auth';
import { database } from '@/lib/database';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response('Not found', { status: 404 });
  const user = await getAppUser(req);
  if (!user) return new Response('Unauthorized', { status: 401 });
  // A client contact reaches a conversation's voice messages and files only on their own client's
  // tasks (or what they just uploaded themselves); the studio reaches its whole workspace.
  const row = (await database().query<{ content_type: string; bytes: Buffer | Uint8Array; size: number; kind: string }>(
    `SELECT a.content_type, a.bytes, a.size, a.kind FROM assets a
     WHERE a.id = $1 AND (a.kind = 'avatar' OR EXISTS (
       SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = a.workspace_id AND wm.user_id = $2 AND (
         wm.role <> 'client' OR a.kind NOT IN ('audio', 'file') OR a.created_by = $2 OR EXISTS (
           SELECT 1 FROM records c JOIN records t ON t.workspace_id = c.workspace_id AND t.kind = 'task' AND t.id = c.data->>'taskId'
           WHERE c.workspace_id = a.workspace_id AND c.kind = 'comment' AND t.data->>'clientId' = wm.client_id
             AND (c.data->>'audio' = a.id OR c.data->'attachments' @> jsonb_build_array(jsonb_build_object('id', a.id)))))))`,
    [id, user.userId],
  ))[0];
  if (!row) return new Response('Not found', { status: 404 });
  const body = row.bytes instanceof Uint8Array ? row.bytes : Buffer.from(row.bytes as unknown as string);
  const download = new URL(req.url).searchParams.get('download');
  return new Response(new Uint8Array(body), { headers: {
    'Content-Type': row.content_type, 'Content-Length': String(body.byteLength),
    'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff',
    // Files open in the browser's own viewer; « Télécharger » asks for a download under their name.
    ...(row.kind === 'file' ? {
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent((download || 'fichier').slice(0, 120))}`,
    } : {}),
  } });
}
