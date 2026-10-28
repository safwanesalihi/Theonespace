// Social statistics, read from the platforms for the posts the app published, and each account's
// followers once a day — the raw material of the Social reports (lib/social-report.ts).
// Server-only. Every reader returns what it could read and never throws: one metric a platform no
// longer offers, or one account to reconnect, must not stop the others.
//
// Per network (with the accounts connected in Social → Comptes):
//   Instagram  like_count, comments_count · insights reach, saved, shares, views · followers_count
//   Facebook   reactions, comments, shares · post reach (insights) or video views · followers_count
//   TikTok     view_count, like_count, comment_count, share_count · follower_count (video.list, user.info.stats)
//   YouTube    viewCount, likeCount, commentCount · subscriberCount
import { database } from '@/lib/database';
import { env } from '@/lib/env';
import { metaGraphVersion } from '@/lib/meta-graph';
import { accountFor } from '@/lib/editorial-publish';
import { loadRecords } from '@/lib/flow-server';
import type { PostStats, RecordItem } from '@/lib/model';
import { listAccounts } from '@/lib/social-accounts';
import { networks, type Network } from '@/lib/social';
import type { FollowerHistory } from '@/lib/social-report';

export const insights = {
  everyHours: 6,          // the scheduled run refreshes a workspace at most this often
  postDays: 90,           // posts published in the last 90 days keep being refreshed
  postsPerRun: 40,        // enough for a busy studio; the rest follow on the next run
  historyDays: 400,       // follower history kept per account
};

type Got<T> = { ok: true; data: T } | { ok: false; error: string };
type Metrics = Omit<PostStats, 'at'>;
type Access = { accountId: string; token: string };

async function getJson<T>(url: string, init: RequestInit = {}): Promise<Got<T>> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
    const data = (await response.json().catch(() => ({}))) as T & { error?: { message?: string; code?: string | number } | string };
    const err = typeof data.error === 'object' ? data.error : undefined;
    // TikTok answers 200 with error.code 'ok' on success.
    if (!response.ok || (err && err.code !== 'ok' && err.message)) return { ok: false, error: err?.message || `HTTP ${response.status}` };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: (error as Error).name === 'TimeoutError' ? 'délai dépassé' : (error as Error).message };
  }
}
const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : undefined);
const clean = (m: Metrics): Metrics => Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined)) as Metrics;

// ---------------------------------------------------------------- Meta

const graph = `https://graph.facebook.com/${metaGraphVersion()}`;
const meta = <T,>(path: string, token: string) => getJson<T>(`${graph}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
type InsightRow = { name: string; values?: { value?: unknown }[]; total_value?: { value?: unknown } };
const insightValue = (rows: InsightRow[] | undefined, name: string) => {
  const row = rows?.find((r) => r.name === name);
  return num(row?.total_value?.value ?? row?.values?.[0]?.value);
};
/** The first metric list the platform accepts (Meta renames and retires metrics between versions). */
async function metaInsights(path: string, token: string, lists: string[]): Promise<InsightRow[] | undefined> {
  for (const list of lists) {
    const got = await meta<{ data?: InsightRow[] }>(`${path}?metric=${list}`, token);
    if (got.ok) return got.data.data;
  }
  return undefined;
}

async function instagramPost(id: string, token: string): Promise<Got<Metrics>> {
  const base = await meta<{ like_count?: number; comments_count?: number }>(`${id}?fields=like_count,comments_count`, token);
  if (!base.ok) return base;
  const rows = await metaInsights(`${id}/insights`, token, ['reach,saved,shares,views', 'reach,saved,shares', 'reach']);
  return { ok: true, data: clean({
    likes: base.data.like_count, comments: base.data.comments_count,
    reach: insightValue(rows, 'reach'), saves: insightValue(rows, 'saved'), shares: insightValue(rows, 'shares'), views: insightValue(rows, 'views'),
  }) };
}

async function facebookPost(id: string, token: string): Promise<Got<Metrics>> {
  const summary = (v?: { summary?: { total_count?: number } }) => v?.summary?.total_count;
  if (!id.includes('_')) {
    // A Reel or a video: its id is the video's.
    const base = await meta<{ likes?: { summary?: { total_count?: number } }; comments?: { summary?: { total_count?: number } } }>(`${id}?fields=likes.summary(true).limit(0),comments.summary(true).limit(0)`, token);
    if (!base.ok) return base;
    const rows = await metaInsights(`${id}/video_insights`, token, ['blue_reels_play_count', 'total_video_views']);
    return { ok: true, data: clean({ likes: summary(base.data.likes), comments: summary(base.data.comments), views: insightValue(rows, 'blue_reels_play_count') ?? insightValue(rows, 'total_video_views') }) };
  }
  type Post = { reactions?: { summary?: { total_count?: number } }; comments?: { summary?: { total_count?: number } }; shares?: { count?: number } };
  const base = await meta<Post>(`${id}?fields=reactions.summary(true).limit(0),comments.summary(true).limit(0),shares`, token);
  if (!base.ok) return base;
  const rows = await metaInsights(`${id}/insights`, token, ['post_impressions_unique', 'post_total_media_view_unique']);
  return { ok: true, data: clean({
    likes: summary(base.data.reactions), comments: summary(base.data.comments), shares: base.data.shares?.count ?? 0,
    reach: insightValue(rows, 'post_impressions_unique') ?? insightValue(rows, 'post_total_media_view_unique'),
  }) };
}

// ---------------------------------------------------------------- TikTok and YouTube

const tiktokScopeHint = 'reconnectez TikTok pour autoriser la lecture des statistiques';

async function tiktokPost(id: string, token: string): Promise<Got<Metrics>> {
  type Video = { id: string; view_count?: number; like_count?: number; comment_count?: number; share_count?: number };
  const got = await getJson<{ data?: { videos?: Video[] } }>('https://open.tiktokapis.com/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ filters: { video_ids: [id] } }),
  });
  if (!got.ok) return { ok: false, error: /scope/i.test(got.error) ? tiktokScopeHint : got.error };
  const v = got.data.data?.videos?.[0];
  if (!v) return { ok: false, error: 'vidéo introuvable sur TikTok' };
  return { ok: true, data: clean({ views: v.view_count, likes: v.like_count, comments: v.comment_count, shares: v.share_count }) };
}

async function youtubePost(id: string, token: string): Promise<Got<Metrics>> {
  const got = await getJson<{ items?: { statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }[] }>(
    `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!got.ok) return got;
  const s = got.data.items?.[0]?.statistics;
  if (!s) return { ok: false, error: 'vidéo introuvable sur YouTube' };
  return { ok: true, data: clean({ views: num(s.viewCount), likes: num(s.likeCount), comments: num(s.commentCount) }) };
}

// ---------------------------------------------------------------- followers

async function followers(network: Network, access: Access): Promise<number | undefined> {
  if (network === 'instagram') {
    const got = await meta<{ followers_count?: number }>(`${access.accountId}?fields=followers_count`, access.token);
    return got.ok ? got.data.followers_count : undefined;
  }
  if (network === 'facebook') {
    const got = await meta<{ followers_count?: number; fan_count?: number }>(`${access.accountId}?fields=followers_count,fan_count`, access.token);
    return got.ok ? got.data.followers_count ?? got.data.fan_count : undefined;
  }
  if (network === 'tiktok') {
    const got = await getJson<{ data?: { user?: { follower_count?: number } } }>('https://open.tiktokapis.com/v2/user/info/?fields=follower_count', { headers: { Authorization: `Bearer ${access.token}` } });
    return got.ok ? got.data.data?.user?.follower_count : undefined;
  }
  const got = await getJson<{ items?: { statistics?: { subscriberCount?: string } }[] }>('https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true', { headers: { Authorization: `Bearer ${access.token}` } });
  return got.ok ? num(got.data.items?.[0]?.statistics?.subscriberCount) : undefined;
}

// ---------------------------------------------------------------- accounts

/**
 * The account and token to read with: the connected account (its token renewed if needed), or the older
 * setup by ids with the system token — for a Facebook Page, the Page's own token.
 */
async function accessFor(workspaceId: string, clientId: string, network: Network, client: RecordItem | undefined, now: Date): Promise<Access | { error: string }> {
  const pseudo = { id: 'stats', kind: 'editorial_post', revision: 0, name: '', createdAt: '', clientId } as RecordItem;
  const account = await accountFor(workspaceId, { network, format: 'post' }, pseudo, client, now);
  if ('error' in account) return account;
  if (account.token) return { accountId: account.accountId, token: account.token };
  const system = env.META_PUBLISH_TOKEN!;
  if (network === 'facebook') {
    const page = await meta<{ access_token?: string }>(`${account.accountId}?fields=access_token`, system);
    if (page.ok && page.data.access_token) return { accountId: account.accountId, token: page.data.access_token };
  }
  return { accountId: account.accountId, token: system };
}

export async function readPost(network: Network, externalId: string, token: string): Promise<Got<Metrics>> {
  if (network === 'instagram') return instagramPost(externalId, token);
  if (network === 'facebook') return facebookPost(externalId, token);
  if (network === 'tiktok') return tiktokPost(externalId, token);
  return youtubePost(externalId, token);
}

// ---------------------------------------------------------------- follower history (meta rows)

const historyId = (workspaceId: string, clientId: string, network: Network) => `social-stats:${workspaceId}:${clientId}:${network}`;
const parse = <T,>(data: unknown) => (typeof data === 'string' ? JSON.parse(data) : data) as T;

export async function followerHistories(workspaceId: string, clientId?: string): Promise<FollowerHistory[]> {
  const prefix = `social-stats:${workspaceId}:${clientId ? `${clientId}:` : ''}`;
  const rows = await database().query<{ data: unknown }>("SELECT data FROM records WHERE workspace_id = $1 AND kind = 'meta' AND starts_with(id, $2)", [workspaceId, prefix]);
  return rows.map((r) => parse<FollowerHistory>(r.data));
}

async function recordFollowers(workspaceId: string, clientId: string, network: Network, count: number, day: string) {
  const id = historyId(workspaceId, clientId, network);
  const existing = (await database().query<{ data: unknown }>("SELECT data FROM records WHERE id = $1 AND workspace_id = $2 AND kind = 'meta'", [id, workspaceId]))[0];
  const history = (existing ? parse<FollowerHistory>(existing.data).history : []).filter((h) => h.day !== day);
  const data: FollowerHistory = { clientId, network, history: [...history, { day, followers: count }].sort((a, b) => a.day.localeCompare(b.day)).slice(-insights.historyDays) };
  await database().query(
    `INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ($1, 'system', $2, 'meta', $3::jsonb, 1)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, revision = records.revision + 1 WHERE records.workspace_id = EXCLUDED.workspace_id`,
    [id, workspaceId, JSON.stringify(data)],
  );
}

// ---------------------------------------------------------------- one refresh

export type RefreshSummary = { posts: number; failed: number; accounts: number; skipped: number };

/**
 * Reads the numbers of the posts published in the last 90 days whose numbers are older than a few hours
 * (or all of them with `force`), and today's followers of every account involved. `clientId` limits it
 * to one client.
 */
export async function refreshInsights(workspaceId: string, { clientId, now = new Date(), force = false }: { clientId?: string; now?: Date; force?: boolean } = {}): Promise<RefreshSummary> {
  const rows = await loadRecords(workspaceId);
  const clients = new Map(rows.filter((r) => r.kind === 'client').map((c) => [c.id, c]));
  const since = now.getTime() - insights.postDays * 86_400_000;
  const stale = now.getTime() - (force ? 0 : insights.everyHours * 3_600_000);
  const summary: RefreshSummary = { posts: 0, failed: 0, accounts: 0, skipped: 0 };
  const accessCache = new Map<string, Promise<Access | { error: string }>>();
  const access = (cid: string, network: Network) => {
    const key = `${cid}:${network}`;
    if (!accessCache.has(key)) accessCache.set(key, accessFor(workspaceId, cid, network, clients.get(cid), now));
    return accessCache.get(key)!;
  };

  const posts = rows.filter((r) => r.kind === 'editorial_post' && !r.archived && (!clientId || r.clientId === clientId) && r.clientId);
  const jobs = posts.flatMap((post) => networks.flatMap((network) => {
    const result = post.publishResults?.[network];
    if (!result?.ok || !result.externalId || result.manual || Date.parse(result.at) < since) return [];
    const last = post.stats?.[network]?.at;
    if (last && Date.parse(last) > stale) return [];
    return [{ post, network, externalId: result.externalId, last: last ? Date.parse(last) : 0 }];
  })).sort((a, b) => a.last - b.last);

  for (const job of jobs) {
    if (summary.posts + summary.failed >= insights.postsPerRun) { summary.skipped++; continue; }
    const acc = await access(job.post.clientId!, job.network);
    const got = 'error' in acc ? { ok: false as const, error: acc.error } : await readPost(job.network, job.externalId, acc.token);
    const stats: PostStats = got.ok ? { ...got.data, at: now.toISOString() } : { ...job.post.stats?.[job.network], at: now.toISOString(), error: got.error };
    if (got.ok) summary.posts++; else summary.failed++;
    // Written next to the post's other data, without touching its revision: an edit in progress keeps working.
    await database().query(
      `UPDATE records SET data = jsonb_set(data, '{stats}', COALESCE(data->'stats', '{}'::jsonb) || jsonb_build_object($1::text, $2::jsonb))
       WHERE id = $3 AND workspace_id = $4`,
      [job.network, JSON.stringify(stats), job.post.id, workspaceId],
    );
  }

  // Followers: every account connected, and every client/network a post went out on (older setup by ids).
  const day = now.toISOString().slice(0, 10);
  const pairs = new Set<string>();
  for (const a of await listAccounts(workspaceId).catch(() => [])) pairs.add(`${a.clientId}|${a.network}`);
  for (const post of posts) for (const n of networks) if (post.publishResults?.[n]?.ok && !post.publishResults[n].manual) pairs.add(`${post.clientId}|${n}`);
  const today = new Set((await followerHistories(workspaceId, clientId)).filter((h) => h.history.at(-1)?.day === day).map((h) => `${h.clientId}|${h.network}`));
  for (const pair of pairs) {
    const [cid, network] = pair.split('|') as [string, Network];
    if ((clientId && cid !== clientId) || (!force && today.has(pair))) continue;
    const acc = await access(cid, network);
    if ('error' in acc) continue;
    const count = await followers(network, acc);
    if (count === undefined) continue;
    await recordFollowers(workspaceId, cid, network, count, day);
    summary.accounts++;
  }
  return summary;
}

// ---------------------------------------------------------------- the scheduled run's gate

const runId = (workspaceId: string) => `social-insights-run:${workspaceId}`;

/** Whether the scheduled run should refresh this workspace now; if so, marks it as done. */
export async function claimScheduledRefresh(workspaceId: string, now = new Date()) {
  const cutoff = new Date(now.getTime() - insights.everyHours * 3_600_000).toISOString();
  const claimed = await database().query(
    `INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ($1, 'system', $2, 'meta', $3::jsonb, 1)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, revision = records.revision + 1
       WHERE records.workspace_id = EXCLUDED.workspace_id AND (records.data->>'at') < $4
     RETURNING id`,
    [runId(workspaceId), workspaceId, JSON.stringify({ at: now.toISOString() }), cutoff],
  );
  return claimed.length > 0;
}
