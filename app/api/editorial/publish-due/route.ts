// The scheduled run: publishes every post whose date and time have come, and finishes the Instagram
// videos still processing from an earlier run. Called with `Authorization: Bearer $CRON_SECRET` —
// by Vercel Cron on a Pro plan, or by any external scheduler (see README → "Publication").
import { env } from '@/lib/env';
import { bearerMatches } from '@/lib/automation-auth';
import { database } from '@/lib/database';
import { duePosts } from '@/lib/editorial-queue';
import { publishPost } from '@/lib/editorial-publish';
import { loadRecords } from '@/lib/flow-server';
import { isPrintWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Enough for a busy morning; the rest are picked up by the next run a few minutes later.
const perRun = 8;

const response = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

async function run(req: Request) {
  if (!bearerMatches(req, env.CRON_SECRET)) {
    return response({ error: 'Publication planifiée non autorisée.' }, env.CRON_SECRET && env.CRON_SECRET.length >= 32 ? 401 : 503);
  }
  const now = new Date();
  const summary: { workspaceId: string; postId: string; status: string; platforms?: Record<string, string> }[] = [];
  try {
    const workspaces = await database().query<{ id: string }>('SELECT id FROM workspaces');
    for (const { id } of workspaces) {
      if (isPrintWorkspaceId(id)) continue;
      for (const post of duePosts(await loadRecords(id), now)) {
        if (summary.length >= perRun) break;
        // Short waits here: a video still processing is simply finished by the next run.
        const result = await publishPost(id, post.id, { now, waitMs: 6_000 });
        summary.push({
          workspaceId: id, postId: post.id, status: result.status,
          ...(result.status === 'done' ? { platforms: Object.fromEntries(Object.values(result.results).map((r) => [r.platform, r.ok ? 'ok' : r.pending ? 'pending' : r.error || 'error'])) } : {}),
        });
      }
    }
    return response({ ok: true, at: now.toISOString(), runs: summary });
  } catch (error) {
    console.error('publish due', error);
    return response({ error: 'Publication planifiée interrompue.', runs: summary }, 503);
  }
}

export const GET = run;
export const POST = run;
