// The scheduled run: creates the day's copy of each repeating post whose time has come, publishes
// every post whose date and time have come, finishes the Instagram videos
// still processing from an earlier run, and — when time is left — refreshes one workspace's social
// statistics (at most every few hours each, lib/social-insights.ts). Called with `Authorization: Bearer $CRON_SECRET` —
// by Vercel Cron on a Pro plan, or by any external scheduler (see README → "Publication").
import { env } from '@/lib/env';
import { bearerMatches } from '@/lib/automation-auth';
import { database } from '@/lib/database';
import { duePosts } from '@/lib/editorial-queue';
import { advanceSeries } from '@/lib/editorial-repeat';
import { publishPost } from '@/lib/editorial-publish';
import { claimScheduledRefresh, refreshInsights, type RefreshSummary } from '@/lib/social-insights';
import { loadRecords } from '@/lib/flow-server';
import { planRefusal } from '@/lib/subscription';
import { isPrintWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Enough for a busy morning; the rest are picked up by the next run a few minutes later.
const perRun = 8;
// No network is started after this long: one Facebook Reel upload can take two minutes, and a run
// Vercel stops at `maxDuration` would leave that Reel half-sent.
const startWithinMs = 120_000;

const response = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

async function run(req: Request) {
  if (!bearerMatches(req, env.CRON_SECRET)) {
    // Seen in Vercel's logs: a scheduler sending the wrong secret (never printed) is easy to spot.
    console.warn('publish due refused', req.headers.has('authorization') ? 'wrong secret' : 'no Authorization header');
    return response({ error: 'Publication planifiée non autorisée.' }, env.CRON_SECRET && env.CRON_SECRET.length >= 32 ? 401 : 503);
  }
  const now = new Date();
  const startBy = now.getTime() + startWithinMs;
  const summary: { workspaceId: string; postId: string; status: string; platforms?: Record<string, string> }[] = [];
  try {
    const workspaces = await database().query<{ id: string }>('SELECT id FROM workspaces');
    for (const { id } of workspaces) {
      if (isPrintWorkspaceId(id)) continue;
      // A suspended company (trial over, plan expired or canceled) is read-only: nothing is created or published for it.
      if (await planRefusal(id)) continue;
      // Repeating posts first: each series whose time has come gets its day's copy, published just below.
      const rows = await loadRecords(id);
      const copies = await advanceSeries(id, rows, now);
      for (const post of duePosts(copies.length ? await loadRecords(id) : rows, now)) {
        if (summary.length >= perRun || Date.now() > startBy) break;
        // Short waits here: a video still processing is simply finished by the next run.
        const result = await publishPost(id, post.id, { now, waitMs: 6_000, startBy });
        summary.push({
          workspaceId: id, postId: post.id, status: result.status,
          ...(result.status === 'done' ? { platforms: Object.fromEntries(Object.values(result.results).map((r) => [r.platform, r.ok ? 'ok' : r.pending ? 'pending' : r.error || 'error'])) } : {}),
        });
      }
    }
    // Statistics ride on the same scheduler: one workspace per run, only while the run has time left.
    let stats: (RefreshSummary & { workspaceId: string }) | null = null;
    if (Date.now() - now.getTime() < 20_000) {
      for (const { id } of workspaces) {
        if (isPrintWorkspaceId(id) || await planRefusal(id) || !(await claimScheduledRefresh(id, now))) continue;
        stats = { workspaceId: id, ...(await refreshInsights(id, { now })) };
        break;
      }
    }
    // One line per run, so Vercel's logs show the scheduler is calling and what each run did.
    const outcomes = summary.flatMap((r) => Object.values(r.platforms ?? {}).map((p) => (p === 'ok' || p === 'pending' ? p : 'failed')));
    console.info('publish due', JSON.stringify({ posts: summary.length, ok: outcomes.filter((p) => p === 'ok').length, pending: outcomes.filter((p) => p === 'pending').length, failed: outcomes.filter((p) => p === 'failed').length, ms: Date.now() - now.getTime(), ...(stats ? { stats: stats.workspaceId } : {}) }));
    return response({ ok: true, at: now.toISOString(), runs: summary, ...(stats ? { stats } : {}) });
  } catch (error) {
    console.error('publish due', error);
    return response({ error: 'Publication planifiée interrompue.', runs: summary }, 503);
  }
}

export const GET = run;
export const POST = run;
