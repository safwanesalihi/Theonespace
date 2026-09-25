// Plan éditorial → Facebook and Instagram, straight from the app: media upload signing, the
// "Publier maintenant" button, the scheduled run, Instagram's processing delay, the claim that stops
// a post going out twice, and the answer that comes back for every platform.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';

const esbuildPath = globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0] || 'node_modules/esbuild/lib/main.js';
const esbuild = await import(pathToFileURL(esbuildPath));
mkdirSync('.sites-runtime', { recursive: true });
const bundles = {
  records: 'app/api/records/route.ts', media: 'app/api/editorial/media/route.ts',
  publish: 'app/api/editorial/publish/route.ts', due: 'app/api/editorial/publish-due/route.ts',
};
for (const [name, entry] of Object.entries(bundles)) {
  await esbuild.build({ entryPoints: [entry], outfile: `.sites-runtime/publishing-${name}.mjs`, bundle: true, platform: 'node', format: 'esm', plugins: [testRuntimePlugin({ auth: false })] });
}
const { db, pg } = await createTestDb();
globalThis.testDb = db;
const CRON = 'c'.repeat(40);
const SUPABASE = 'https://proj.supabase.test';
const env = {
  OWNER_EMAIL: 'owner@studio.test', AUTH_URL: 'https://space.test', CRON_SECRET: CRON,
  SUPABASE_URL: SUPABASE, SUPABASE_SERVICE_ROLE_KEY: 'service-key', META_PUBLISH_TOKEN: 'system-token',
  META_STUDIO_FACEBOOK_PAGE_ID: '5555555555',
};
globalThis.testEnv = env; // lib/env binds this very object, so later edits are seen
const owner = { userId: 'owner', fullName: 'Owner', displayName: 'Owner', email: 'owner@studio.test' };
globalThis.testUser = owner;
const load = async (name) => import(pathToFileURL(`${process.cwd()}/.sites-runtime/publishing-${name}.mjs`));
const [records, media, publish, due] = await Promise.all(['records', 'media', 'publish', 'due'].map(load));

// ---- Meta and Supabase, stubbed: every call recorded, answers scripted per test.
const calls = [];
const containerStatus = new Map();   // containerId → status_code
let failNext = null;                 // { match: RegExp, message } → that call answers with a Meta error
let containers = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url), method = init.method || 'GET';
  const body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
  const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.startsWith(SUPABASE)) {
    calls.push({ service: 'storage', method, url: u, body });
    if (u.includes('/object/upload/sign/')) return reply({ url: u.slice(`${SUPABASE}/storage/v1`.length) + '?token=signed' });
    return reply({});
  }
  if (!u.startsWith('https://graph.facebook.com/')) return realFetch(url, init);
  const path = u.slice('https://graph.facebook.com/v21.0/'.length);
  calls.push({ service: 'meta', method, path, body, auth: init.headers?.Authorization });
  if (failNext && failNext.match.test(`${method} ${path}`)) {
    const message = failNext.message; failNext = null;
    return reply({ error: { code: 100, message: 'Invalid parameter', error_user_msg: message } }, 400);
  }
  if (method === 'GET' && /\?fields=access_token$/.test(path)) return reply(path.startsWith('0000000000') ? { id: '0' } : { access_token: 'page-token' });
  if (method === 'POST' && /\/photos$/.test(path)) return reply({ id: 'photo1', post_id: `${path.split('/')[0]}_777` });
  if (method === 'POST' && /\/videos$/.test(path)) return reply({ id: 'video1' });
  if (method === 'POST' && /\/media$/.test(path)) { const id = `container-${++containers}`; if (!containerStatus.has(id)) containerStatus.set(id, body.media_type === 'REELS' ? 'IN_PROGRESS' : 'FINISHED'); return reply({ id }); }
  if (method === 'GET' && /^container-\d+\?fields=status_code/.test(path)) return reply({ status_code: containerStatus.get(path.split('?')[0]) });
  if (method === 'POST' && /\/media_publish$/.test(path)) return reply({ id: `ig-${body.creation_id}` });
  if (method === 'GET' && /\?fields=permalink$/.test(path)) return reply({ permalink: `https://www.instagram.com/p/${path.split('?')[0]}/` });
  return reply({ error: { message: `unexpected ${method} ${path}` } }, 500);
};
const metaCalls = () => calls.filter((c) => c.service === 'meta');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const WS = 'ws:owner';
const request = (route, body, { workspace = WS, origin = 'https://space.test' } = {}) => route.POST(new Request('https://space.test/api/x', {
  method: 'POST', headers: { 'Content-Type': 'application/json', origin, 'X-Workspace-Id': workspace }, body: JSON.stringify(body),
}));
async function post(body, status = 200) {
  const r = await request(records, body); const d = await r.json(); assert.equal(r.status, status, JSON.stringify(d)); checks++; return d;
}
async function publishNow(postId, status = 200) {
  const r = await request(publish, { postId }); const d = await r.json(); assert.equal(r.status, status, JSON.stringify(d)); checks++; return d;
}
async function scheduled(secret = CRON) {
  const r = await due.GET(new Request('https://space.test/api/editorial/publish-due', { headers: secret ? { Authorization: `Bearer ${secret}` } : {} }));
  return { status: r.status, body: await r.json() };
}
const casablanca = (offsetDays = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(new Date(Date.now() + offsetDays * 86_400_000));

await records.GET(new Request('https://space.test/api/records'));
const boot = await post({ action: 'mark-read', ids: [] });
const platform = (name) => boot.records.find((r) => r.kind === 'platform' && r.name === name).id;
const [IG, FB, TT] = [platform('Instagram'), platform('Facebook'), platform('TikTok')];
const client = await post({ action: 'create', kind: 'client', data: { name: 'Kojo Bakery', facebookPageId: '1111111111', instagramId: '2222222222' } });
const noAccounts = await post({ action: 'create', kind: 'client', data: { name: 'Sans comptes' } });

// 1. Media: a signed upload straight to storage, JPEG photos and MP4/MOV videos only.
{
  const r = await request(media, { contentType: 'image/jpeg', size: 400_000 });
  const d = await r.json();
  eq(r.status, 200, JSON.stringify(d));
  ok(/^ws_owner\/[0-9a-f-]{36}\.jpg$/.test(d.path), 'a random path per workspace');
  eq([d.mediaType, d.publicUrl], ['image', `${SUPABASE}/storage/v1/object/public/editorial-media/${d.path}`], 'a public URL Meta can fetch');
  ok(d.uploadUrl.startsWith(`${SUPABASE}/storage/v1/object/upload/sign/editorial-media/${d.path}`), 'a signed upload URL for the browser');
  eq((await request(media, { contentType: 'image/png', size: 1000 })).status, 415, 'PNG is refused (Instagram publishes JPEG only; the browser converts)');
  eq((await request(media, { contentType: 'video/mp4', size: 200_000_000 })).status, 413, 'an oversized video is refused');
  eq((await request(media, { contentType: 'image/jpeg', size: 1000 }, { origin: 'https://evil.test' })).status, 403, 'Origin is checked');
  eq((await request(media, { contentType: 'image/jpeg', size: 1000 }, { workspace: 'ws:owner:print' })).status, 400, 'never the print workspace');
  delete env.SUPABASE_URL;
  eq((await request(media, { contentType: 'image/jpeg', size: 1000 })).status, 503, 'storage not configured → a clear refusal');
  env.SUPABASE_URL = SUPABASE;
}

const mediaFields = (type = 'image', n = 1) => ({ mediaUrl: `${SUPABASE}/storage/v1/object/public/editorial-media/ws_owner/${'0'.repeat(7)}${n}-0000-0000-0000-000000000000.${type === 'image' ? 'jpg' : 'mp4'}`, mediaType: type, mediaPath: `ws_owner/${'0'.repeat(7)}${n}-0000-0000-0000-000000000000.${type === 'image' ? 'jpg' : 'mp4'}` });
const newPost = async (data) => {
  const d = await post({ action: 'create', kind: 'editorial_post', data: { name: 'Post', clientId: client.id, due: casablanca(5), description: 'Nouvelle collection ✨', ...data } });
  return d.records.find((r) => r.id === d.id);
};

// 2. "Publier maintenant": a photo to Facebook and Instagram in one click, with the answer for each.
{
  const p = await newPost({ name: 'Lancement', channels: [FB, IG], ...mediaFields('image', 1) });
  eq([p.mediaType, p.mediaPath], ['image', mediaFields('image', 1).mediaPath], 'the post keeps its media type and storage path');
  calls.length = 0;
  const out = await publishNow(p.id);
  eq(out.results[FB], { ok: true, at: out.results[FB].at, externalId: '1111111111_777', url: 'https://www.facebook.com/1111111111_777', platform: 'Facebook' }, 'Facebook answers with the post and its link');
  eq([out.results[IG].ok, out.results[IG].url], [true, 'https://www.instagram.com/p/ig-container-1/'], 'Instagram answers with the permalink');
  ok(out.post.publishedAt, 'every platform done → the post is marked published');
  ok(!out.post.publishingAt, 'and released');
  const photo = metaCalls().find((c) => /\/photos$/.test(c.path));
  eq([photo.path, photo.body.url, photo.body.caption, photo.auth], ['1111111111/photos', mediaFields('image', 1).mediaUrl, 'Nouvelle collection ✨', 'Bearer page-token'], 'Facebook: the client’s Page, the media URL, the caption, with the Page’s own token');
  const container = metaCalls().find((c) => /\/media$/.test(c.path));
  eq([container.path, container.body.image_url, container.body.caption, container.body.media_type], ['2222222222/media', mediaFields('image', 1).mediaUrl, 'Nouvelle collection ✨', undefined], 'Instagram: the client’s account, a photo container with the caption');
  ok(out.post.history.some((h) => h.text === 'Publié sur Facebook') && out.post.history.some((h) => h.text === 'Publié sur Instagram'), 'the post history says where it went');
  const feed = (await post({ action: 'mark-read', ids: [] })).records.find((r) => r.kind === 'event' && r.id.startsWith(`evt:${p.id}:publish:`));
  ok(feed && /publié sur Facebook/.test(feed.name) && /publié sur Instagram/.test(feed.name), 'and the studio feed hears about it');
  calls.length = 0;
  await publishNow(p.id);
  eq(metaCalls().length, 0, 'a second click on a published post publishes nothing again');
}

// 3. Partial failure: the platform that can go out does; the other says exactly why.
{
  const p = await (async () => { const d = await post({ action: 'create', kind: 'editorial_post', data: { name: 'Sans compte', clientId: noAccounts.id, due: casablanca(5), channels: [FB, TT], ...mediaFields('image', 2) } }); return d.records.find((r) => r.id === d.id); })();
  const out = await publishNow(p.id);
  eq([out.results[FB].ok, out.results[FB].error], [false, 'Ajoutez l’identifiant de la Page Facebook sur la fiche du client.'], 'a client without a Page id is told so');
  eq([out.results[TT].ok, /non prise en charge/.test(out.results[TT].error)], [false, true], 'TikTok is reported as not supported');
  ok(!out.post.publishedAt, 'not published while a platform is missing');
}
{
  const p = await newPost({ name: 'Refusé', channels: [IG], ...mediaFields('image', 3) });
  failNext = { match: /^POST 2222222222\/media$/, message: 'The aspect ratio is not supported.' };
  const out = await publishNow(p.id);
  eq([out.results[IG].ok, out.results[IG].error], [false, 'The aspect ratio is not supported.'], 'Meta’s own reason comes back to the app');
  ok(out.post.history.some((h) => h.text === 'Échec sur Instagram : The aspect ratio is not supported.'), 'and is kept in the history');
  const retry = await publishNow(p.id);
  ok(retry.results[IG].ok, 'a click retries a failed platform right away');
}

// 4. Formats that can't go out as they are.
{
  const story = await newPost({ name: 'Story', postType: 'Story', channels: [FB, IG], ...mediaFields('image', 4) });
  calls.length = 0;
  const out = await publishNow(story.id);
  ok(/stories Facebook/.test(out.results[FB].error), 'a Facebook story is refused with a reason');
  ok(out.results[IG].ok, 'an Instagram story goes out');
  eq(metaCalls().find((c) => /\/media$/.test(c.path)).body, { media_type: 'STORIES', image_url: mediaFields('image', 4).mediaUrl }, 'as STORIES, without a caption');
  const carousel = await newPost({ name: 'Carrousel', postType: 'Carrousel', channels: [IG], ...mediaFields('image', 5) });
  ok(/carrousels/.test((await publishNow(carousel.id)).results[IG].error), 'a carousel is refused with a reason');
}

// 5. Guards: nothing to publish, a role that may not publish, no configuration, a post already running.
{
  const bare = await newPost({ name: 'Sans média', channels: [FB] });
  eq((await publishNow(bare.id, 400)).error, 'Ajoutez une photo ou une vidéo avant de publier.');
  const noPlatform = await newPost({ name: 'Sans plateforme', ...mediaFields('image', 6) });
  eq((await publishNow(noPlatform.id, 400)).error, 'Choisissez au moins une plateforme.');
  await pg.query("INSERT INTO users (id, name, email, password_hash) VALUES ('crea', 'Yasmine', 'y@studio.test', 'x')");
  await pg.query("INSERT INTO workspace_members (workspace_id, user_id, role, name, email) VALUES ($1, 'crea', 'creative', 'Yasmine', 'y@studio.test')", [WS]);
  const guarded = await newPost({ name: 'Rôle', channels: [FB], ...mediaFields('image', 7) });
  globalThis.testUser = { userId: 'crea', fullName: 'Yasmine', displayName: 'Yasmine', email: 'y@studio.test' };
  eq((await publishNow(guarded.id, 403)).error, 'Seuls le propriétaire et les administrateurs publient.', 'a member may prepare posts but not publish them');
  globalThis.testUser = owner;
  delete env.META_PUBLISH_TOKEN;
  eq((await publishNow(guarded.id, 503)).error, 'La publication n’est pas configurée (META_PUBLISH_TOKEN).');
  env.META_PUBLISH_TOKEN = 'system-token';
  // A run already talking to Meta holds the post: a second click can't publish it twice.
  await pg.query("UPDATE records SET data = jsonb_set(data, '{publishingAt}', to_jsonb($1::text)) WHERE id = $2", [new Date().toISOString(), guarded.id]);
  calls.length = 0;
  eq((await publishNow(guarded.id, 409)).error, 'Ce post est déjà en cours de publication.', 'a post being published is held');
  eq(metaCalls().length, 0, 'and Meta is not called a second time');
  await pg.query("UPDATE records SET data = jsonb_set(data, '{publishingAt}', to_jsonb($1::text)) WHERE id = $2", [new Date(Date.now() - 11 * 60_000).toISOString(), guarded.id]);
  ok((await publishNow(guarded.id)).results[FB].ok, 'a hold left by a run that died expires after ten minutes');
}

// 6. Internal posts go out on the studio's own accounts.
{
  const d = await post({ action: 'create', kind: 'editorial_post', data: { name: 'Studio', clientId: 'internal', due: casablanca(5), channels: [FB, IG], ...mediaFields('image', 8) } });
  calls.length = 0;
  const out = await publishNow(d.id);
  eq(metaCalls().find((c) => /\/photos$/.test(c.path)).path, '5555555555/photos', 'the studio’s Page');
  eq(out.results[IG].error, 'Compte Instagram du studio non configuré (META_STUDIO_INSTAGRAM_ID).', 'a missing studio account is named');
}

// 7. The scheduled run: only what's due, and it finishes Instagram videos still processing.
{
  eq((await scheduled(null)).status, 401, 'the scheduler needs CRON_SECRET');
  const future = await newPost({ name: 'Demain', channels: [FB], ...mediaFields('image', 9) });
  const later = await newPost({ name: 'Ce soir', channels: [FB], due: casablanca(0), time: '23:59', ...mediaFields('image', 10) });
  const now = await newPost({ name: 'Ce matin', channels: [FB], due: casablanca(0), time: '00:00', ...mediaFields('image', 11) });
  const missed = await newPost({ name: 'Hier', channels: [FB], due: casablanca(-1), ...mediaFields('image', 12) });
  const old = await newPost({ name: 'Trop ancien', channels: [FB], due: casablanca(-10), ...mediaFields('image', 13) });
  const reel = await newPost({ name: 'Reel', postType: 'Reel', channels: [IG], due: casablanca(-1), ...mediaFields('video', 14) });
  const run = await scheduled();
  eq(run.status, 200, JSON.stringify(run.body));
  const ran = new Set(run.body.runs.map((r) => r.postId));
  ok(ran.has(now.id) && ran.has(missed.id), 'posts whose date and time have come go out, and one missed yesterday is caught up');
  ok(!ran.has(future.id) && !ran.has(later.id) && !ran.has(old.id), 'not before their date or hour, and not ten days late');
  eq(run.body.runs.find((r) => r.postId === reel.id).platforms, { Instagram: 'pending' }, 'a video Instagram is still processing is left pending');
  const pending = (await post({ action: 'mark-read', ids: [] })).records.find((r) => r.id === reel.id);
  eq([pending.publishResults[IG].pending, pending.publishedAt], [true, undefined], 'shown as in progress, not failed');
  const reelContainer = metaCalls().find((c) => c.body?.video_url === mediaFields('video', 14).mediaUrl);
  eq(reelContainer.body.media_type, 'REELS', 'a video goes to Instagram as a Reel');
  containerStatus.set(pending.publishResults[IG].containerId, 'FINISHED');
  calls.length = 0;
  const next = await scheduled();
  eq(next.body.runs.find((r) => r.postId === reel.id).platforms, { Instagram: 'ok' }, 'the next run publishes it once Instagram is done');
  eq(metaCalls().filter((c) => /\/media$/.test(c.path) && c.body?.video_url).length, 0, 'without uploading it a second time');
  ok((await post({ action: 'mark-read', ids: [] })).records.find((r) => r.id === reel.id).publishedAt, 'and marks the post published');
  eq((await scheduled()).body.runs.filter((r) => [now.id, missed.id, reel.id].includes(r.postId)).length, 0, 'nothing already out goes out again');
}

// 8. The file leaves storage with its post.
{
  const p = await newPost({ name: 'À supprimer', ...mediaFields('image', 15) });
  calls.length = 0;
  await post({ action: 'delete', kind: 'editorial_post', id: p.id, revision: p.revision });
  const removal = calls.find((c) => c.service === 'storage' && c.method === 'DELETE');
  eq(removal?.body, { prefixes: [mediaFields('image', 15).mediaPath] }, 'deleting a post removes its file');
  const q = await newPost({ name: 'Remplacé', ...mediaFields('image', 16) });
  calls.length = 0;
  await post({ action: 'update', kind: 'editorial_post', id: q.id, revision: q.revision, data: { name: 'Remplacé', clientId: client.id, due: casablanca(5), ...mediaFields('video', 17) } });
  eq(calls.find((c) => c.method === 'DELETE')?.body, { prefixes: [mediaFields('image', 16).mediaPath] }, 'replacing the media removes the old file');
}

globalThis.fetch = realFetch;
await pg.close();
console.log(`${checks} publishing checks passed: media upload, publish now, per-platform answers, stories/carousels, roles, hold, studio accounts, schedule, Instagram processing, storage cleanup.`);
