// Instagram search (lib/ig-analyzer/search*.ts, /api/ig/search), beside the IG Analyzer: the tiers and
// the engagement rate, which accounts are kept and why the others are not, the two Apify runs (stubbed)
// with their cost cap, who may search, the daily budget, the searches kept 48 h, and the CSV.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';

const esbuildPath = globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0] || 'node_modules/esbuild/lib/main.js';
const esbuild = await import(pathToFileURL(esbuildPath));
mkdirSync('.sites-runtime', { recursive: true });
const { db, pg } = await createTestDb();
globalThis.testDb = db;
const env = { OWNER_EMAIL: 'owner@studio.test', AUTH_URL: 'https://space.test', APIFY_TOKEN: 'apify-test' };
globalThis.testEnv = env;
const bundle = async (entry, out) => {
  await esbuild.build({ entryPoints: [entry], outfile: `.sites-runtime/${out}`, bundle: true, platform: 'node', format: 'esm', plugins: [testRuntimePlugin({ auth: false })] });
  return import(pathToFileURL(`${process.cwd()}/.sites-runtime/${out}`));
};
const records = await bundle('app/api/records/route.ts', 'igs-records.mjs');
const route = await bundle('app/api/ig/search/route.ts', 'igs-route.mjs');
const model = await bundle('lib/ig-analyzer/search-model.ts', 'igs-model.mjs');
const store = await bundle('lib/ig-analyzer/store.ts', 'igs-store.mjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

// ---- Apify, stubbed: profiles shaped like the search and profile actors' items.
const post = (likes, comments, i) => ({ type: 'Image', url: `https://www.instagram.com/p/p${i}/`, likesCount: likes, commentsCount: comments, timestamp: '2026-10-01T10:00:00.000Z', displayUrl: `https://scontent.cdninstagram.com/t${i}.jpg` });
const profile = (username, followers, extra = {}) => ({
  username, fullName: username.replace(/[._]/g, ' '), biography: 'Coach sportif', followersCount: followers, followsCount: 300, postsCount: 120,
  verified: false, private: false, isBusinessAccount: true, businessCategoryName: 'Personal coach', url: `https://www.instagram.com/${username}/`,
  profilePicUrl: `https://scontent.cdninstagram.com/${username}.jpg`, latestPosts: [post(400, 20, 1), post(600, 40, 2), post(-1, 10, 3)], ...extra,
});
const searchItems = [
  profile('fit.casa', 12000, { biography: 'Coach sportif à Casablanca 🇲🇦', searchTerm: 'coach sportif casablanca' }),
  profile('big.gym', 250000, { searchTerm: 'casablanca coach sportif', verified: true }),
  profile('fit.casa', 12000), // the same account found by a second search
  profile('tiny.coach', 400),
  profile('hidden.coach', 50000, { private: true }),
  profile('empty.coach', 8000, { postsCount: 0, latestPosts: [] }),
  profile('casa.yoga', 3500, { biography: 'Yoga · CASABLANCA', fullName: 'Yoga' }),
  { error: 'not_found', inputUrl: 'ghost' },
];
const apify = [];
let apifyStatus = 200;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.startsWith('https://api.apify.com/')) {
    const body = JSON.parse(init.body);
    apify.push({ url: u, body, key: new Headers(init.headers).get('authorization') });
    if (apifyStatus !== 200) return reply({ error: { message: 'Monthly usage hard limit exceeded' } }, apifyStatus);
    if (u.includes('instagram-search-scraper')) return reply(searchItems);
    if (u.includes('instagram-profile-scraper')) return reply(body.usernames.filter((n) => n !== 'nobody.here').map((n) => profile(n, n === 'natgeo' ? 280_000_000 : 20_000)));
    return reply([]);
  }
  return realFetch(url, init);
};

const WS = 'ws:owner';
const B = 'https://space.test';
const owner = { userId: 'owner', fullName: 'Owner', displayName: 'Owner', email: 'owner@studio.test' };
const as = (user) => { globalThis.testUser = user; };
const call = async (method, body, status = 200, { origin = B } = {}) => {
  const req = new Request(`${B}/api/ig/search`, { method, headers: { 'Content-Type': 'application/json', origin, 'X-Workspace-Id': WS }, body: body ? JSON.stringify(body) : undefined });
  const r = await (method === 'GET' ? route.GET(req) : route.POST(req));
  const d = await r.json(); assert.equal(r.status, status, JSON.stringify(d)); checks++; return d;
};
const people = async (id, role) => {
  await pg.query('INSERT INTO users (id, name, email, password_hash) VALUES ($1, $1, $2, $3)', [id, `${id}@studio.test`, 'x']);
  await pg.query('INSERT INTO workspace_members (workspace_id, user_id, role, name, email) VALUES ($1, $2, $3, $2, $4)', [WS, id, role, `${id}@studio.test`]);
  return { userId: id, fullName: id, displayName: id, email: `${id}@studio.test` };
};

// 1. The numbers, as the skill computes them.
{
  eq([999, 1000, 9999, 10_000, 99_999, 100_000, 1_000_000, 1_000_001].map(model.influencerTier), ['nano', 'micro', 'micro', 'mid', 'mid', 'macro', 'macro', 'mega'], 'tiers by followers');
  const p = model.normalizeProfile(profile('fit.casa', 12000), {});
  eq([p.avg_likes, p.avg_comments, p.engagement_rate], [500, 23, 4.36], 'averages over the latest posts; a hidden like count (-1) is left out');
  eq([p.category, p.business_category, p.location, p.profile_url], ['Personal coach', 'Personal coach', null, 'https://www.instagram.com/fit.casa/'], 'category falls back to Instagram’s business category');
  const hidden = model.normalizeProfile(profile('x.y', 5000, { latestPosts: [post(-1, 3, 1)] }), {});
  eq([hidden.avg_likes, hidden.engagement_rate], [null, null], 'no visible likes: no rate rather than a wrong one');
  eq(model.defaultTerms('Casablanca', 'coach sportif'), ['coach sportif Casablanca', 'Casablanca coach sportif', 'coachsportifcasablanca'], 'three searches from a city and a theme');
  eq(model.defaultTerms('', 'food'), ['food'], 'a theme alone is one search');
}

// 2. Who may search: the owner and admins, like the analyzer.
as(owner);
await records.GET(new Request(`${B}/api/records`));
const admin = await people('admin', 'admin');
for (const role of ['creative', 'social', 'client']) {
  as(await people(role, role));
  await call('GET', null, 403);
  await call('POST', { action: 'discover', location: 'Casablanca', category: 'coach' }, 403);
}
eq(apify.length, 0, 'and nothing reached Apify');
as(admin);
const start = await call('GET');
eq([start.configured, start.searches, start.left, start.perDay], [true, [], 10, 10], 'set up, nothing kept, the day’s budget');
await call('POST', { action: 'discover' }, 403, { origin: 'https://evil.test' });

// 3. By city and theme: one search run, capped in cost; kept and left out, each with its reason.
{
  await call('POST', { action: 'discover', location: '', category: '' }, 400);
  eq(apify.length, 0, 'an empty search is refused before Apify');
  const d = await call('POST', { action: 'discover', location: 'Casablanca', category: 'coach sportif' });
  const run = apify.at(-1);
  ok(run.url.includes('apify~instagram-search-scraper') && run.url.includes('maxTotalChargeUsd=0.12'), 'the search actor, with a cost cap (30 profiles × $0.004)');
  eq(run.body, { search: 'coach sportif Casablanca, Casablanca coach sportif, coachsportifcasablanca', searchType: 'user', searchLimit: 10 }, 'three searches, ten accounts each');
  eq(run.key, 'Bearer apify-test', 'with the server’s key');
  const s = d.search;
  eq(s.profiles.map((p) => p.username), ['big.gym', 'fit.casa', 'casa.yoga'], 'public, active accounts above 1 000 followers, once each, biggest first');
  eq(s.skipped, { low_followers: ['tiny.coach'], private: ['hidden.coach'], no_posts: ['empty.coach'], not_found: ['ghost'] }, 'the others, by reason');
  eq(s.profiles.map((p) => p.says_location), [false, true, true], 'which bios actually say the city (accents and case aside)');
  eq([s.profiles[0].influencer_tier, s.profiles[0].is_verified, s.profiles[1].search_term], ['macro', true, 'coach sportif casablanca'], 'tier, verified, and the search that found it');
  eq([s.location, s.category, s.mode, s.fetched], ['Casablanca', 'coach sportif', 'discover', 8], 'labelled with what was asked');
  eq([d.searches.length, d.left], [1, 9], 'kept, and counted');

  const own = await call('POST', { action: 'discover', location: 'Rabat', category: 'yoga', terms: ['yoga rabat', '  ', 'yoga rabat'], minFollowers: 5000 });
  eq(apify.at(-1).body.search, 'yoga rabat', 'the searches as edited, without blanks or repeats');
  ok(apify.at(-1).url.includes('maxTotalChargeUsd=0.05'), 'a small search gets the smallest cap');
  eq(own.search.profiles.map((p) => p.username), ['big.gym', 'fit.casa'], 'a higher threshold keeps fewer');
}

// 4. A list of accounts: names, @names and links; invalid ones refused before Apify.
{
  const before = apify.length;
  await call('POST', { action: 'profiles', usernames: 'natgeo, not a name!' }, 400);
  await call('POST', { action: 'profiles', usernames: Array.from({ length: 31 }, (_, i) => `acc${i}`).join('\n') }, 400);
  await call('POST', { action: 'profiles', usernames: '   ' }, 400);
  eq(apify.length, before, 'none of these reached Apify');
  const d = await call('POST', { action: 'profiles', usernames: '@NatGeo\nhttps://www.instagram.com/nasa/?hl=fr\nnatgeo\nnobody.here' });
  ok(apify.at(-1).url.includes('apify~instagram-profile-scraper'), 'the profile actor');
  eq(apify.at(-1).body, { usernames: ['natgeo', 'nasa', 'nobody.here'] }, 'cleaned and without repeats');
  eq([d.search.profiles.map((p) => [p.username, p.influencer_tier]), d.search.skipped], [[['natgeo', 'mega'], ['nasa', 'mid']], { not_found: ['nobody.here'] }], 'an account Apify returns nothing for is not found');
}

// 5. Apify failing: a clear answer, and nothing kept.
{
  apifyStatus = 402;
  const kept = (await call('GET')).searches.length;
  const d = await call('POST', { action: 'discover', location: 'Fès', category: 'café' }, 502);
  eq(d.error, 'Monthly usage hard limit exceeded', 'Apify’s reason');
  eq((await call('GET')).searches.length, kept, 'a failed search is not kept');
  apifyStatus = 200;
}

// 6. Kept: the five newest, each 48 h; removed by hand; the daily budget holds.
{
  let list = (await call('GET')).searches;
  ok(list.every((s) => Date.parse(s.expiresAt) - Date.parse(s.at) === 48 * 3600_000), 'each search goes 48 h after it ran');
  await call('POST', { action: 'remove', id: list[0].id });
  eq((await call('GET')).searches.length, list.length - 1, 'removed by hand');
  for (let i = 0; i < 4; i++) await call('POST', { action: 'profiles', usernames: `acc${i}` });
  list = (await call('GET')).searches;
  eq(list.length, 5, 'the five newest are kept');
  eq((await call('GET')).left, 2, 'eight searches spent (the failed one counts: Apify was called)');
  await call('POST', { action: 'profiles', usernames: 'last.one' });
  await call('POST', { action: 'profiles', usernames: 'last.two' });
  const refused = await call('POST', { action: 'profiles', usernames: 'one.more' }, 429);
  ok(/Limite quotidienne/.test(refused.error), 'the eleventh search of the day is refused');
  const later = Date.now() + 49 * 3600_000;
  eq((await store.listSearches(WS, later)).length, 0, 'two days on, nothing is kept');
  eq((await call('GET')).searches.length, 0, 'and the expired searches are gone for good');
}

// 7. The CSV: the skill's columns, one row per kept profile, quoted where needed.
{
  const rows = model.normalizeProfile(profile('a.b', 2000, { biography: 'Line one\nwith "quotes", and commas' }), { location: 'Casablanca', discover: true });
  const csv = model.toCsv([rows]).split('\r\n');
  eq(csv[0].split(',').slice(0, 4), ['username', 'full_name', 'bio', 'followers'], 'the header');
  ok(csv[1].startsWith('a.b,a b,"Line one\nwith ""quotes"", and commas",2000,'), 'text with commas, quotes and new lines is quoted');
  ok(csv[1].endsWith('https://scontent.cdninstagram.com/t1.jpg|https://scontent.cdninstagram.com/t2.jpg|https://scontent.cdninstagram.com/t3.jpg'), 'the post thumbnails, joined');
}

console.log(`${checks} Instagram search checks passed: tiers and engagement, kept and left out, both Apify runs with a cost cap, roles, budget, 48 h keeping, CSV.`);
