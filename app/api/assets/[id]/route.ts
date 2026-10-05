// Serves an upload to signed-in members of its workspace (profile pictures to any signed-in user). Ids are unique per upload, so responses cache forever.
import { getAppUser } from '@/lib/auth';
import { database } from '@/lib/database';
import { inlineTaskFile } from '@/lib/task-files';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response('Not found', { status: 404 });
  const user = await getAppUser(req);
  if (!user) return new Response('Unauthorized', { status: 401 });
  // A client contact reaches a conversation's voice messages and files only on their own client's
  // tasks (or what they just uploaded themselves); the studio reaches its whole workspace.
  const db = database();
  const row = (await db.query<{ content_type: string; size: number; kind: string }>(
    `SELECT a.content_type, a.size, a.kind FROM assets a
     WHERE a.id = $1 AND a.kind IN ('avatar', 'logo', 'banner', 'audio', 'file') AND (a.kind = 'avatar' OR EXISTS (
       SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = a.workspace_id AND wm.user_id = $2 AND (
         wm.role <> 'client' OR a.kind NOT IN ('audio', 'file') OR a.created_by = $2 OR EXISTS (
           SELECT 1 FROM records c JOIN records t ON t.workspace_id = c.workspace_id AND t.kind = 'task' AND t.id = c.data->>'taskId'
           WHERE c.workspace_id = a.workspace_id AND c.kind = 'comment' AND t.data->>'clientId' = wm.client_id
             AND (c.data->>'audio' = a.id OR c.data->'attachments' @> jsonb_build_array(jsonb_build_object('id', a.id)))))))`,
    [id, user.userId],
  ))[0];
  if (!row) return new Response('Not found', { status: 404 });
  const download = new URL(req.url).searchParams.get('download');
  const range = req.headers.get('Range');
  let start = 0, end = row.size - 1;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${row.size}` } });
    if (match[1]) { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
    else { start = Math.max(0, row.size - Number(match[2])); }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= row.size || (match[1] === '' && Number(match[2]) === 0)) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${row.size}` } });
    }
  }
  const headers: Record<string, string> = {
    'Content-Type': row.content_type, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff',
    ...(range ? { 'Content-Range': `bytes ${start}-${end}/${row.size}` } : {}),
    ...(row.kind === 'file' ? {
      'Content-Disposition': `${download || !inlineTaskFile(row.content_type) ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent((download || 'fichier').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120))}`,
      ...(!inlineTaskFile(row.content_type) ? { 'Content-Security-Policy': "sandbox; default-src 'none'" } : {}),
    } : {}),
  };
  if (req.method === 'HEAD') return new Response(null, { status: range ? 206 : 200, headers });
  // Pull a bounded slice at a time. Range requests let players seek without loading the whole video.
  let offset = start, cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (cancelled || req.signal.aborted) { controller.close(); return; }
      try {
        const length = Math.min(1_000_000, end - offset + 1);
        const slice = (await db.query<{ bytes: Uint8Array }>('SELECT substring(bytes from $2::int for $3::int) AS bytes FROM assets WHERE id = $1', [id, offset + 1, length]))[0];
        if (!slice || slice.bytes.byteLength !== length) throw new Error('File no longer available');
        if (cancelled) return;
        controller.enqueue(new Uint8Array(slice.bytes)); offset += length;
        if (offset > end) controller.close();
      } catch (error) { if (!cancelled) controller.error(error); }
    },
    cancel() { cancelled = true; },
  });
  return new Response(body, { status: range ? 206 : 200, headers });
}

export const HEAD = GET;
