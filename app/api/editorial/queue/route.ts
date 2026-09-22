import { z } from 'zod';
import { env } from '@/lib/env';
import { bearerMatches } from '@/lib/automation-auth';
import { database } from '@/lib/database';
import { dueJobs, type PublishJob } from '@/lib/editorial-queue';
import { dayIn } from '@/lib/flow';
import { loadRecords } from '@/lib/flow-server';
import type { PublishResult, RecordItem } from '@/lib/model';
import { isPrintWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

/**
 * Publishing queue for the n8n automation — the only machine-facing view of the editorial plan.
 *
 * GET  → one job per (post, platform) still to publish — the selection rules and their constants
 *        live in lib/editorial-queue.ts.
 * POST → the outcome for one job. The post is marked `publishedAt` once every platform succeeded.
 *
 * Authentication: `Authorization: Bearer $AUTOMATION_SECRET` (see .env.example).
 */
const response = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

const unauthorized = () => {
  const secret = env.AUTOMATION_SECRET;
  return response({ error: 'Automatisation non autorisée.' }, secret && secret.length >= 32 ? 401 : 503);
};

export async function GET(req: Request) {
  if (!bearerMatches(req, env.AUTOMATION_SECRET)) return unauthorized();
  try {
    const now = new Date();
    const workspaces = await database().query<{ id: string }>('SELECT id FROM workspaces');
    const jobs: PublishJob[] = [];
    for (const { id } of workspaces) {
      if (isPrintWorkspaceId(id)) continue;
      jobs.push(...dueJobs(await loadRecords(id), id, now));
    }
    return response({ ok: true, today: dayIn(now), at: now.toISOString(), jobs });
  } catch (error) {
    console.error('editorial queue', error);
    return response({ error: 'File de publication indisponible.' }, 503);
  }
}

const resultFields = z.object({
  postId: z.string().min(1).max(100),
  workspaceId: z.string().min(1).max(200),
  platformId: z.string().min(1).max(200),
  ok: z.boolean(),
  externalId: z.string().max(200).optional(),
  url: z.string().max(2000).optional(),
  error: z.string().max(2000).optional(),
});

export async function POST(req: Request) {
  if (!bearerMatches(req, env.AUTOMATION_SECRET)) return unauthorized();
  let body: unknown;
  try { body = await req.json(); } catch { return response({ error: 'Requête invalide.' }, 400); }
  const parsed = resultFields.safeParse(body);
  if (!parsed.success) return response({ error: parsed.error.issues[0].message }, 400);
  const { postId, workspaceId, platformId, ok, externalId, url, error } = parsed.data;
  try {
    const records = await loadRecords(workspaceId);
    const post = records.find((r) => r.id === postId && r.kind === 'editorial_post');
    if (!post) return response({ error: 'Post introuvable.' }, 404);
    const platform = records.find((r) => r.id === platformId && r.kind === 'platform');
    if (!platform || !post.channels?.includes(platformId)) return response({ error: 'Plateforme non ciblée par ce post.' }, 400);
    const now = new Date().toISOString();
    const result: PublishResult = { ok, at: now, ...(externalId && { externalId }), ...(url && { url }), ...(!ok && { error: error || 'Erreur inconnue.' }) };
    const publishResults = { ...post.publishResults, [platformId]: result };
    const published = post.channels.every((id) => publishResults[id]?.ok);
    const item: RecordItem = {
      ...post, publishResults,
      ...(published && !post.publishedAt && { publishedAt: now }),
      history: [...(post.history || []), { text: ok ? `Publié sur ${platform.name}` : `Échec sur ${platform.name} : ${result.error}`, date: now }].slice(-100),
    };
    // Bump the revision: an open editorial calendar refreshes and shows the new state. A concurrent
    // edit in the app loses the race and gets its usual 409; n8n's result is the one worth keeping.
    const changed = await database().query(
      'UPDATE records SET data = $1::jsonb, revision = revision + 1 WHERE id = $2 AND workspace_id = $3 AND revision = $4 RETURNING revision',
      [JSON.stringify(item), post.id, workspaceId, post.revision],
    );
    if (!changed.length) return response({ error: 'Modification simultanée. Réessayez.' }, 409);
    return response({ ok: true, published, publishedAt: item.publishedAt ?? null });
  } catch (err) {
    console.error('editorial result', err);
    return response({ error: 'Résultat non enregistré.' }, 503);
  }
}
