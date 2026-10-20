// IG Analyzer (lib/ig-analyzer, /api/ig, /api/ig/img): who may use it, reading an account through Apify
// (stubbed), the cache, the follower history, the list of accounts, the picture proxy, and the numbers.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';

process.env.TZ = 'UTC';
const esbuildPath = globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0] || 'node_modules/esbuild/lib/main.js';
const esbuild = await import(pathToFileURL(esbuildPath));
mkdirSync('.sites-runtime', { recursive: true });
const { db, pg } = await createTestDb();
globalThis.testDb = db;
const env = { OWNER_EMAIL: 'owner@studio.test', AUTH_URL: 'https://space.test' };
globalThis.testEnv = env;
const bundle = async (entry, out) => {
  await esbuild.build({ entryPoints: [entry], outfile: `.sites-runtime/${out}`, bundle: true, platform: 'node', format: 'esm', plugins: [testRuntimePlugin({ auth: false })] });
  return import(pathToFileURL(`${process.cwd()}/.sites-runtime/${out}`));
};
const records = await bundle('app/api/records/route.ts', 'ig-records.mjs');
const ig = await bundle('app/api/ig/route.ts', 'ig-route.mjs');
const img = await bundle('app/api/ig/img/route.ts', 'ig-img.mjs');
const scraper = await bundle('lib/ig-analyzer/scraper.ts', 'ig-scraper.mjs');
const analyze = await bundle('lib/ig-analyzer/analyze.ts', 'ig-analyze.mjs');
const sweep = await bundle('app/api/flow/sweep/route.ts', 'ig-sweep.mjs');
/** The list without its expiry dates (checked on their own below). */
const names = (list) => list.map(({ expiresAt, ...a }) => a);

// ---- Apify and Instagram's image hosts, stubbed.
const apify = [];
let followers = 1200;
let apifyStatus = 200;
const at = (day, hour) => new Date(Date.UTC(2026, 8, day, hour)).toISOString();
const rawPosts = [
  ...Array.from({ length: 6 }, (_, i) => ({ id: `r${i}`, productType: 'clips', type: 'Video', caption: `Reel ${i}\n#studio #reel`, timestamp: at(1 + i, 18), shortCode: `r${i}`, displayUrl: `https://scontent.cdninstagram.com/r${i}.jpg`, likesCount: i === 0 ? 900 : 100, commentsCount: 10, videoPlayCount: i === 0 ? 40000 : 5000, videoDuration: 20 })),
  ...Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, type: 'Image', caption: `Photo ${i} #studio`, timestamp: at(10 + i, 9), url: `https://www.instagram.com/p/p${i}/`, likesCount: i === 1 ? -1 : 40, commentsCount: 2 })),
  { id: 'r0', productType: 'clips', type: 'Video', caption: 'duplicate', timestamp: at(1, 18) },
  { id: 'x1', type: 'Image', caption: 'someone else', timestamp: at(2, 10), ownerUsername: 'other', likesCount: 1 },
  { error: 'no_items' },
];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.startsWith('https://api.apify.com/')) {
    const body = JSON.parse(init.body);
    apify.push({ url: u, body, key: new Headers(init.headers).get('authorization') });
    if (apifyStatus !== 200) return reply({ error: { message: 'nope' } }, apifyStatus);
    if (u.includes('instagram-profile-scraper')) {
      const name = body.usernames[0];
      if (name === 'ghost') return reply([{ error: 'not_found' }]);
      return reply([{ username: name === 'kojo.bakery' ? 'Kojo.Bakery' : name, fullName: 'Kojo', followersCount: followers, followsCount: 10, postsCount: 80, profilePicUrlHD: 'https://scontent.cdninstagram.com/pic.jpg', private: name === 'secret' }]);
    }
    return reply(rawPosts);
  }
  if (u.startsWith('https://scontent.cdninstagram.com/')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': u.endsWith('.txt') ? 'text/html' : 'image/jpeg' } });
  return realFetch(url, init);
};

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const WS = 'ws:owner';
const B = 'https://space.test';
const owner = { userId: 'owner', fullName: 'Owner', displayName: 'Owner', email: 'owner@studio.test' };
const as = (user) => { globalThis.testUser = user; };
const call = async (method, { query = '', body, ws = WS, origin = B } = {}, status = 200) => {
  const headers = { 'Content-Type': 'application/json', origin };
  if (ws) headers['X-Workspace-Id'] = ws;
  const req = new Request(`${B}/api/ig${query}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const r = await (method === 'GET' ? ig.GET(req) : ig.POST(req));
  const d = await r.json(); assert.equal(r.status, status, JSON.stringify(d)); checks++; return d;
};
const scan = (username, refresh, status) => call('POST', { body: { action: 'scan', username, refresh } }, status);
const people = async (id, role) => {
  await pg.query('INSERT INTO users (id, name, email, password_hash) VALUES ($1, $1, $2, $3)', [id, `${id}@studio.test`, 'x']);
  await pg.query('INSERT INTO workspace_members (workspace_id, user_id, role, name, email) VALUES ($1, $2, $3, $2, $4)', [WS, id, role, `${id}@studio.test`]);
  return { userId: id, fullName: id, displayName: id, email: `${id}@studio.test` };
};

// 1. Usernames and links.
{
  const p = scraper.parseUsername;
  eq(['Kojo.Bakery', '@kojo.bakery', 'instagram.com/kojo.bakery', 'https://www.instagram.com/kojo.bakery/?hl=fr'].map(p), Array(4).fill('kojo.bakery'), 'names, @names and profile links');
  eq([p(''), p('not a name!'), p('a'.repeat(31))], [null, null, null], 'nonsense is refused');
  assert.throws(() => p('https://www.instagram.com/reel/abc/'), /lien d’une publication/); checks++;
  eq([scraper.isInstagramImage('https://scontent-cdg4-1.cdninstagram.com/v/x.jpg'), scraper.isInstagramImage('https://x.fbcdn.net/y.jpg'), scraper.isInstagramImage('https://evil.com/cdninstagram.com.jpg'), scraper.isInstagramImage('http://scontent.cdninstagram.com/x.jpg'), scraper.isInstagramImage('https://cdninstagram.com.evil.com/x.jpg')],
    [true, true, false, false, false], 'only Instagram’s own image hosts, over https');
}

// 2. Who may use it: the owner and admins; not creatives, social managers or clients.
as(owner);
await records.GET(new Request(`${B}/api/records`));
const admin = await people('admin', 'admin');
const crea = await people('crea', 'creative');
const smm = await people('smm', 'social');
const client = await people('client', 'client');
for (const who of [crea, smm, client]) {
  as(who);
  const d = await call('GET', { query: '?view=accounts' }, 403);
  ok(/réservée au propriétaire/.test(d.error), `${who.userId} is refused`);
  await scan('kojo.bakery', false, 403);
}
as(null); await call('GET', { query: '?view=status' }, 401);
as({ ...owner, mustChangePassword: true }); await call('GET', { query: '?view=status' }, 403);
as(owner); await call('GET', { query: '?view=status', ws: 'ws:owner:print' }, 403);
await call('GET', { query: '?view=status', ws: 'ws:nobody' }, 403);
await call('POST', { body: { action: 'scan', username: 'kojo.bakery' }, origin: 'https://evil.test' }, 403);
eq(apify.length, 0, 'Apify is never called for those refused');

// 3. Not configured yet: says so, calls nobody.
eq((await call('GET', { query: '?view=status' })).configured, false, 'no APIFY_TOKEN, not configured');
ok(/APIFY_TOKEN/.test((await scan('kojo.bakery', false, 503)).error), 'scanning asks for the key');
eq(apify.length, 0, 'and calls nobody');

// 4. Reading an account.
env.APIFY_TOKEN = 'apify-test-key';
env.IG_POSTS_LIMIT = '500';
eq((await call('GET', { query: '?view=status' })), { configured: true, postsLimit: 200 }, 'configured; the posts limit is capped at 200');
as(admin);
const first = await scan('https://www.instagram.com/Kojo.Bakery/');
eq(apify.length, 2, 'two Apify actors: the profile and the posts');
eq(apify.map((c) => c.key), ['Bearer apify-test-key', 'Bearer apify-test-key'], 'with the key, server side');
eq(apify.find((c) => c.url.includes('apify~instagram-scraper')).body, { directUrls: ['https://www.instagram.com/kojo.bakery/'], resultsType: 'posts', resultsLimit: 200 }, 'the posts actor gets the profile URL and the limit');
eq(first.account.profile.username, 'kojo.bakery', 'the username is lower-cased');
eq(first.account.posts.length, 12, 'duplicates, other owners’ posts and errors are dropped');
eq(first.account.posts.find((p) => p.id === 'r0').type, 'REEL', 'clips are reels');
eq(first.account.posts.find((p) => p.id === 'r0').permalink, 'https://www.instagram.com/p/r0/', 'a permalink from the short code');
eq(first.account.posts.find((p) => p.id === 'p1').likes, null, 'hidden likes stay unknown, not -1');
eq(names(first.accounts), [{ username: 'kojo.bakery', isMe: true }], 'the first account read becomes « Mon compte »');
eq(first.history['kojo.bakery'].map((h) => h.followers), [1200], 'and the day’s follower count is kept');

// 5. The cache: a second scan costs nothing; a refresh within 10 minutes neither.
followers = 1300;
const again = await scan('kojo.bakery');
eq([again.cached, apify.length], [true, 2], 'served from the cache');
await scan('kojo.bakery', true);
eq(apify.length, 2, 'a refresh within 10 minutes is served from the cache too');
const cachedId = `ig-account:${WS}:kojo.bakery`;
const old = new Date(Date.now() - 20 * 60_000).toISOString();
await pg.query(`UPDATE records SET data = jsonb_set(data, '{fetchedAt}', to_jsonb($1::text)) WHERE id = $2`, [old, cachedId]);
const fresh = await scan('kojo.bakery', true);
eq([apify.length, fresh.account.profile.followers_count], [4, 1300], 'an older reading is read again');
eq(fresh.history['kojo.bakery'].map((h) => h.followers), [1300], 'one follower count per day: the latest wins');
const histId = `ig-history:${WS}:kojo.bakery`;
await pg.query(`UPDATE records SET data = '{"points":[{"date":"2026-09-01","followers":1000}]}'::jsonb WHERE id = $1`, [histId]);
await pg.query(`UPDATE records SET data = jsonb_set(data, '{fetchedAt}', to_jsonb($1::text)) WHERE id = $2`, [old, cachedId]);
eq((await scan('kojo.bakery', true)).history['kojo.bakery'].map((h) => h.followers), [1000, 1300], 'another day adds a point');
eq((await call('GET', { query: '?view=account&username=kojo.bakery' })).profile.username, 'kojo.bakery', 'the last reading, by name');
await call('GET', { query: '?view=account&username=nobody' }, 404);

// 6. Errors come back in words.
ok(/introuvable/.test((await scan('ghost', false, 404)).error), 'an unknown account');
ok(/compte privé/.test((await scan('secret', false, 403)).error), 'a private account');
ok(/lien d’une publication/.test((await scan('instagram.com/p/abc', false, 400)).error), 'a post link');
ok(/nom d’utilisateur/.test((await scan('???', false, 400)).error), 'nonsense');
apifyStatus = 401;
ok(/APIFY_TOKEN/.test((await scan('atlas', false, 502)).error), 'a refused key');
apifyStatus = 200;
eq((await call('GET', { query: '?view=accounts' })).accounts.map((a) => a.username), ['kojo.bakery'], 'failed reads are not tracked');

// 7. The list: another account, « Mon compte », removing.
await scan('atlas');
as(owner);
eq(names((await call('POST', { body: { action: 'set-me', username: 'atlas' } })).accounts), [{ username: 'kojo.bakery' }, { username: 'atlas', isMe: true }], 'one « Mon compte » at a time');
eq(names((await call('POST', { body: { action: 'remove', username: 'kojo.bakery' } })).accounts), [{ username: 'atlas', isMe: true }], 'removed');
eq((await pg.query('SELECT count(*)::int AS n FROM records WHERE id = ANY($1)', [[cachedId, histId]])).rows[0].n, 0, 'with its reading and history');
await call('POST', { body: { action: 'dance', username: 'atlas' } }, 400);
const loaded = await (await records.GET(new Request(`${B}/api/records`, { headers: { 'X-Workspace-Id': WS } }))).json();
ok(!loaded.records.some((r) => String(r.id).startsWith('ig-')), 'none of it reaches the records everyone loads');

// 7b. Kept to save space: the page removes an analysis once its PDF is saved (« remove » above); one
// nobody exported goes two days after its reading — when the list is read, and in the daily sweep.
{
  const atlasId = `ig-account:${WS}:atlas`;
  const readAt = (await pg.query("SELECT data->>'fetchedAt' AS at FROM records WHERE id = $1", [atlasId])).rows[0].at;
  const list = (await call('GET', { query: '?view=accounts' })).accounts;
  eq(list.map((a) => [a.username, a.expiresAt]), [['atlas', new Date(Date.parse(readAt) + 48 * 3600_000).toISOString()]], 'each account says when it goes: two days after its reading');
  await pg.query(`UPDATE records SET data = jsonb_set(data, '{fetchedAt}', to_jsonb($1::text)) WHERE id = $2`, [new Date(Date.now() - 47 * 3600_000).toISOString(), atlasId]);
  eq((await call('GET', { query: '?view=accounts' })).accounts.map((a) => a.username), ['atlas'], 'still kept at 47 hours');
  await pg.query(`UPDATE records SET data = jsonb_set(data, '{fetchedAt}', to_jsonb($1::text)) WHERE id = $2`, [new Date(Date.now() - 49 * 3600_000).toISOString(), atlasId]);
  eq((await call('GET', { query: '?view=accounts' })).accounts, [], 'gone after two days, unexported');
  eq((await pg.query("SELECT count(*)::int AS n FROM records WHERE id LIKE $1", [`ig-%:${WS}:atlas`])).rows[0].n, 0, 'its reading and history deleted');

  // A new scan of an expired account reads Instagram again instead of serving the old reading.
  await scan('atlas');
  const calls = apify.length;
  await pg.query(`UPDATE records SET data = jsonb_set(data, '{fetchedAt}', to_jsonb($1::text)) WHERE id = $2`, [new Date(Date.now() - 49 * 3600_000).toISOString(), atlasId]);
  const again = await scan('atlas');
  ok(apify.length > calls && !again.cached, 'an expired reading is read again, not served from the cache');

  // The daily sweep does it for every workspace, even one nobody opens.
  await pg.query(`UPDATE records SET data = jsonb_set(data, '{fetchedAt}', to_jsonb($1::text)) WHERE id = $2`, [new Date(Date.now() - 49 * 3600_000).toISOString(), atlasId]);
  env.CRON_SECRET = 'c'.repeat(40);
  const swept = await (await sweep.GET(new Request(`${B}/api/flow/sweep`, { headers: { authorization: `Bearer ${'c'.repeat(40)}` } }))).json();
  eq([swept.ok, swept.igRemoved], [true, 1], 'the daily sweep deletes it');
  eq((await pg.query("SELECT count(*)::int AS n FROM records WHERE id LIKE $1", [`ig-%:${WS}:atlas`])).rows[0].n, 0, 'nothing left behind');
  ok(!(await call('GET', { query: '?view=accounts' })).accounts.length, 'and the list is empty');
}

// 8. The picture proxy.
const pic = async (u, status) => { const r = await img.GET(new Request(`${B}/api/ig/img?ws=${encodeURIComponent(WS)}&u=${encodeURIComponent(u)}`)); assert.equal(r.status, status); checks++; return r; };
const r = await pic('https://scontent.cdninstagram.com/pic.jpg', 200);
eq([r.headers.get('content-type'), r.headers.get('x-content-type-options')], ['image/jpeg', 'nosniff'], 'an image, not sniffed');
await pic('https://evil.com/pic.jpg', 404);
await pic('https://scontent.cdninstagram.com/page.txt', 404);
as(crea); await pic('https://scontent.cdninstagram.com/pic.jpg', 403);

// 9. The numbers.
{
  const a = analyze.analyzeAccount(first.account);
  eq(a.posts.length, 12, 'every post is analysed');
  eq(a.posts[0].id, 'p5', 'newest first');
  eq(a.formats.map((f) => [f.type, f.count]), [['REEL', 6], ['IMAGE', 6]], 'formats');
  const r0 = a.posts.find((p) => p.id === 'r0');
  ok(r0.viral && r0.perf >= 2, 'a post far above the account’s median is viral');
  eq(a.viralCount, 1, 'only that one');
  eq(a.medViews, 5000, 'typical reel views are the median');
  eq(a.timing[2][6].n, 1, 'day × 3-hour grid (Tuesday 1 Sept, 18:00 UTC)');
  eq(a.durations.find((d) => d.label === '15–30 s').n, 6, 'reel lengths');
  ok(a.tags.some((t) => t.tag === '#studio' && t.count === 12), 'hashtags');
  const recs = analyze.recommendations(a);
  ok(recs.some((x) => x.title[0] === 'Publiez plus de {format}' && x.title[1].format === 'reels'), 'post more of the stronger format');
  ok(recs.some((x) => x.title[0] === 'Refaites les publications virales'), 'remake the viral posts');
  eq(analyze.median([3, null, 1, 2, 10]), 2.5, 'median ignores the unknown');
}

globalThis.fetch = realFetch;
await pg.close();
console.log(`${checks} IG Analyzer checks passed: usernames, owner and admins only, not configured, reading through Apify, the cache, follower history, errors in words, « Mon compte », removing, deleted once exported or after two days, the picture proxy, the numbers.`);
