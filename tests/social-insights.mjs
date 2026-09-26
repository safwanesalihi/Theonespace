// Social statistics and reports: reading each network's numbers for the published posts and the
// accounts' followers (platforms stubbed), who may read and refresh them, what a client sees, the
// scheduled refresh, and the report's arithmetic (totals, engagement, weeks, top posts, CSV).
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';

const esbuildPath = globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0] || 'node_modules/esbuild/lib/main.js';
const esbuild = await import(pathToFileURL(esbuildPath));
mkdirSync('.sites-runtime', { recursive: true });
const { db, pg } = await createTestDb();
globalThis.testDb = db;
const env = { OWNER_EMAIL: 'owner@studio.test', AUTH_URL: 'https://space.test', AUTH_SECRET: 's'.repeat(48), CRON_SECRET: 'c'.repeat(40) };
globalThis.testEnv = env;
const bundle = async (entry, out) => {
  await esbuild.build({ entryPoints: [entry], outfile: `.sites-runtime/${out}`, bundle: true, platform: 'node', format: 'esm', plugins: [testRuntimePlugin({ auth: false })] });
  return import(pathToFileURL(`${process.cwd()}/.sites-runtime/${out}`));
};
const records = await bundle('app/api/records/route.ts', 'insights-records.mjs');
const route = await bundle('app/api/social/insights/route.ts', 'insights-route.mjs');
const due = await bundle('app/api/editorial/publish-due/route.ts', 'insights-due.mjs');
const accounts = await bundle('lib/social-accounts.ts', 'insights-accounts.mjs');
const report = await bundle('lib/social-report.ts', 'insights-report.mjs');

// ---- the platforms, stubbed
const calls = [];
let followers = { ig: 1200, fb: 800, tt: 5000, yt: 300 };
let igInsightsFail = false;
const realFetch = globalThis.fetch;
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  calls.push({ url: u, auth: new Headers(init.headers).get('authorization'), body: init.body });
  if (u.startsWith('https://graph.facebook.com/v21.0/')) {
    const path = u.slice('https://graph.facebook.com/v21.0/'.length);
    if (path.startsWith('ig-post-1?fields=like_count')) return reply({ like_count: 40, comments_count: 5 });
    if (path.startsWith('ig-post-1/insights')) {
      if (igInsightsFail && path.includes('views')) return reply({ error: { message: 'metric views not supported', code: 100 } }, 400);
      return reply({ data: [{ name: 'reach', values: [{ value: 900 }] }, { name: 'saved', values: [{ value: 12 }] }, { name: 'shares', values: [{ value: 3 }] }, ...(path.includes('views') ? [{ name: 'views', total_value: { value: 2000 } }] : [])] });
    }
    if (path.startsWith('1111_222?fields=reactions')) return reply({ reactions: { summary: { total_count: 25 } }, comments: { summary: { total_count: 4 } }, shares: { count: 6 } });
    if (path.startsWith('1111_222/insights')) return reply({ data: [{ name: 'post_impressions_unique', values: [{ value: 500 }] }] });
    if (path.startsWith('2222?fields=followers_count')) return reply({ followers_count: followers.ig });
    if (path.startsWith('1111?fields=followers_count')) return reply({ followers_count: followers.fb, fan_count: 700 });
    if (path.startsWith('deleted-post')) return reply({ error: { message: 'Object does not exist', code: 100 } }, 400);
    return reply({ error: { message: `unexpected ${path}` } }, 500);
  }
  if (u.startsWith('https://open.tiktokapis.com/v2/video/query/')) return reply({ data: { videos: [{ id: '7123', view_count: 15000, like_count: 800, comment_count: 30, share_count: 45 }] }, error: { code: 'ok', message: '' } });
  if (u.startsWith('https://open.tiktokapis.com/v2/user/info/')) return reply({ data: { user: { follower_count: followers.tt } }, error: { code: 'ok', message: '' } });
  if (u.startsWith('https://www.googleapis.com/youtube/v3/videos')) return reply({ items: [{ statistics: { viewCount: '3400', likeCount: '120', commentCount: '9' } }] });
  if (u.startsWith('https://www.googleapis.com/youtube/v3/channels')) return reply({ items: [{ statistics: { subscriberCount: String(followers.yt) } }] });
  return realFetch(url, init);
};

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const WS = 'ws:owner';
const B = 'https://space.test';
const owner = { userId: 'owner', fullName: 'Owner', displayName: 'Owner', email: 'owner@studio.test' };
const as = (user) => { globalThis.testUser = user; };
as(owner);
const post = async (body, status = 200) => {
  const r = await records.POST(new Request(`${B}/api/records`, { method: 'POST', headers: { 'Content-Type': 'application/json', origin: B, 'X-Workspace-Id': WS }, body: JSON.stringify(body) }));
  const d = await r.json(); assert.equal(r.status, status, JSON.stringify(d)); checks++; return d;
};
const insightsGet = async (query = '') => { const r = await route.GET(new Request(`${B}/api/social/insights${query}`, { headers: { 'X-Workspace-Id': WS } })); return { status: r.status, body: await r.json() }; };
const insightsPost = async (body = {}) => { const r = await route.POST(new Request(`${B}/api/social/insights`, { method: 'POST', headers: { 'Content-Type': 'application/json', origin: B, 'X-Workspace-Id': WS }, body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };

await records.GET(new Request(`${B}/api/records`));
const client = await post({ action: 'create', kind: 'client', data: { name: 'Kojo Bakery' } });
const other = await post({ action: 'create', kind: 'client', data: { name: 'Atlas Motors' } });
for (const [network, externalId, name] of [['instagram', '2222', '@kojo'], ['facebook', '1111', 'Kojo Bakery'], ['tiktok', 'tt-open', 'Kojo TikTok'], ['youtube', 'UC1', 'Kojo TV']]) {
  await accounts.saveAccount(WS, { clientId: client.id, network, externalId, name, token: `${network}-token`, connectedBy: 'Owner' });
}
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString();
// A post published on four networks five days ago, another deleted on Facebook, one outside 90 days.
const published = await post({ action: 'create', kind: 'editorial_post', data: { name: 'Lancement', clientId: client.id, due: today, description: 'Nouvelle collection', socialState: 'scheduled',
  targets: [{ network: 'instagram', format: 'post' }, { network: 'facebook', format: 'post' }, { network: 'tiktok', format: 'video' }, { network: 'youtube', format: 'short', title: 'Lancement' }] } });
const gone = await post({ action: 'create', kind: 'editorial_post', data: { name: 'Supprimé', clientId: client.id, due: today, socialState: 'scheduled', targets: [{ network: 'facebook', format: 'post' }] } });
const old = await post({ action: 'create', kind: 'editorial_post', data: { name: 'Ancien', clientId: client.id, due: today, socialState: 'scheduled', targets: [{ network: 'facebook', format: 'post' }] } });
const setResults = (id, results) => pg.query("UPDATE records SET data = jsonb_set(data, '{publishResults}', $1::jsonb) WHERE id = $2", [JSON.stringify(results), id]);
await setResults(published.id, {
  instagram: { ok: true, at: daysAgo(5), externalId: 'ig-post-1', url: 'https://instagram.com/p/1' },
  facebook: { ok: true, at: daysAgo(5), externalId: '1111_222' },
  tiktok: { ok: true, at: daysAgo(5), externalId: '7123' },
  youtube: { ok: true, at: daysAgo(5), externalId: 'yt-1' },
});
await setResults(gone.id, { facebook: { ok: true, at: daysAgo(3), externalId: 'deleted-post' } });
await setResults(old.id, { facebook: { ok: true, at: daysAgo(120), externalId: '1111_999' } });
const stored = async (id) => (await db.query('SELECT data, revision FROM records WHERE id = $1', [id]))[0];

// 1. « Actualiser »: each network's numbers, followers, errors kept per post, nothing outside 90 days.
{
  const before = (await stored(published.id)).revision;
  const r = await insightsPost();
  eq(r.status, 200, JSON.stringify(r.body));
  eq([r.body.posts, r.body.failed], [4, 1], 'four networks read, the deleted post reported');
  const s = (await stored(published.id)).data.stats;
  eq([s.instagram.likes, s.instagram.comments, s.instagram.reach, s.instagram.saves, s.instagram.shares, s.instagram.views], [40, 5, 900, 12, 3, 2000], 'Instagram: likes, comments, reach, saves, shares, views');
  eq([s.facebook.likes, s.facebook.comments, s.facebook.shares, s.facebook.reach], [25, 4, 6, 500], 'Facebook: reactions, comments, shares, reach');
  eq([s.tiktok.views, s.tiktok.likes, s.tiktok.comments, s.tiktok.shares], [15000, 800, 30, 45], 'TikTok: views, likes, comments, shares');
  eq([s.youtube.views, s.youtube.likes, s.youtube.comments], [3400, 120, 9], 'YouTube: views, likes, comments');
  eq((await stored(published.id)).revision, before, 'written without touching the post’s revision (an edit in progress still saves)');
  ok((await stored(gone.id)).data.stats.facebook.error.includes('does not exist'), 'a post deleted on the platform keeps the reason');
  ok(!(await stored(old.id)).data.stats, 'a post older than 90 days is left alone');
  ok(calls.some((c) => c.url.includes('ig-post-1') && c.auth === 'Bearer instagram-token'), 'each network with its connected account’s token');
  const tt = calls.find((c) => c.url.includes('/video/query/'));
  eq(JSON.parse(tt.body), { filters: { video_ids: ['7123'] } }, 'TikTok asked for that video');
  eq(r.body.histories.map((h) => [h.network, h.history.at(-1).followers]).sort(), [['facebook', 800], ['instagram', 1200], ['tiktok', 5000], ['youtube', 300]], 'today’s followers on every connected account');
}

// 2. Meta retires a metric: the next list is used, the rest still read.
{
  igInsightsFail = true;
  await insightsPost({ clientId: client.id });
  const s = (await stored(published.id)).data.stats.instagram;
  eq([s.reach, s.views, s.likes], [900, undefined, 40], 'without “views”, reach and likes are still read');
  igInsightsFail = false;
}

// 3. Who may read and refresh.
{
  await pg.query("INSERT INTO users (id, name, email, password_hash) VALUES ('crea', 'Y', 'y@s.test', 'x'), ('boss', 'K', 'k@k.test', 'x')");
  await pg.query("INSERT INTO workspace_members (workspace_id, user_id, role, name, email, client_id) VALUES ($1, 'crea', 'creative', 'Y', 'y@s.test', NULL), ($1, 'boss', 'client', 'K', 'k@k.test', $2)", [WS, client.id]);
  as({ userId: 'crea', fullName: 'Y', displayName: 'Y', email: 'y@s.test' });
  eq((await insightsGet()).status, 403, 'a « Membre » does not see the statistics');
  eq((await insightsPost()).status, 403, 'nor refresh them');
  as({ userId: 'boss', fullName: 'K', displayName: 'K', email: 'k@k.test' });
  const mine = await insightsGet(`?clientId=${other.id}`);
  ok(mine.status === 200 && mine.body.histories.length === 4 && mine.body.histories.every((h) => h.clientId === client.id), 'a client contact gets their own followers, whatever they ask for');
  eq((await insightsPost()).status, 403, 'a client does not refresh');
  const view = await (await records.GET(new Request(`${B}/api/records`, { headers: { 'X-Workspace-Id': WS } }))).json();
  const theirs = view.records.find((r) => r.id === gone.id);
  ok(theirs.stats.facebook && !('error' in theirs.stats.facebook), 'the portal shows the numbers without the studio’s error notes');
  ok(!('externalId' in theirs.publishResults.facebook), 'and never a platform id');
  as(owner);
}

// 4. The scheduled run refreshes a workspace at most every six hours.
{
  const cron = () => due.GET(new Request(`${B}/api/editorial/publish-due`, { headers: { Authorization: `Bearer ${env.CRON_SECRET}` } })).then((r) => r.json());
  const first = await cron();
  eq(first.stats?.workspaceId, WS, 'the scheduled run refreshes the statistics');
  const second = await cron();
  ok(!second.stats, 'and not again within six hours');
  await pg.query("UPDATE records SET data = jsonb_build_object('at', $1::text) WHERE id = $2", [daysAgo(1), `social-insights-run:${WS}`]);
  ok((await cron()).stats, 'again once the six hours are past');
}

// 5. The report: totals, engagement, followers’ growth, weeks, top posts, filters and CSV.
{
  followers = { ig: 1300, fb: 810, tt: 5000, yt: 300 };
  await pg.query("UPDATE records SET data = jsonb_set(data, '{history}', $1::jsonb) WHERE id = $2", [JSON.stringify([{ day: '2020-01-01', followers: 1000 }, { day: today, followers: 1200 }]), `social-stats:${WS}:${client.id}:instagram`]);
  const view = await (await records.GET(new Request(`${B}/api/records`, { headers: { 'X-Workspace-Id': WS } }))).json();
  const histories = (await insightsGet()).body.histories;
  const period = report.periodFor('30', today);
  const r = report.socialReport(view.records, histories, period, { clientId: client.id });
  eq(r.totals.posts, 2, 'two posts published in the period (the old one is outside)');
  eq(r.totals.interactions, (40 + 5 + 3 + 12) + (25 + 4 + 6) + (800 + 30 + 45) + (120 + 9), 'interactions: likes, comments, shares and saves, every network');
  const ig = r.byNetwork.find((n) => n.network === 'instagram');
  eq([ig.posts, ig.reach, ig.interactions, Math.round(ig.engagement * 1000)], [1, 900, 60, 67], 'Instagram: reach 900, 60 interactions, 6.7 % engagement');
  eq([ig.followers, ig.followersDelta], [1200, 200], 'Instagram followers and their growth over the period');
  eq(r.top[0].network, 'tiktok', 'the best post comes first');
  ok(r.weekly.length >= 4 && r.weekly.some((w) => w.interactions > 0), 'every week of the period, the quiet ones too');
  eq(r.unread.map((u) => u.name), ['Supprimé'], 'a post whose numbers couldn’t be read is listed');
  eq(report.socialReport(view.records, histories, period, { clientId: other.id }).totals.posts, 0, 'another client’s report is empty');
  const lastMonth = report.periodFor('last-month', '2026-03-15');
  eq(lastMonth, { from: '2026-02-01', to: '2026-02-28' }, 'last month, month lengths respected');
  eq(report.periodFor('month', '2026-03-15'), { from: '2026-03-01', to: '2026-03-15' }, 'this month so far');
  const csv = report.reportCsv(view.records, period, (id) => (id === client.id ? 'Kojo Bakery' : ''), client.id);
  const lines = csv.trim().split('\r\n');
  eq(lines.length, 1 + 5, 'one line per post and network, plus the header');
  ok(lines.some((l) => l.includes('"Instagram"') && l.includes('"900"') && l.includes('"6,7 %"')), 'with the numbers and the engagement rate');
}

globalThis.fetch = realFetch;
await pg.close();
console.log(`${checks} social statistics checks passed: Instagram, Facebook, TikTok and YouTube numbers, followers, retired metrics, deleted posts, 90-day window, access (studio, member, client), portal view, scheduled refresh, report totals, engagement, growth, weeks, top posts, periods and CSV.`);
