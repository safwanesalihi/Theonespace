// The Social hub → Facebook and Instagram, straight from the app: media upload signing, « Publier
// maintenant », the scheduled run, carousels and multi-photo posts, Instagram's processing delay, the
// claim that stops a post going out twice, the client's approval, networks posted by hand, and the
// answer that comes back for every network.
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
  drive: 'app/api/editorial/media/drive/route.ts',
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
const as = (user) => { globalThis.testUser = user; };
as(owner);
const load = async (name) => import(pathToFileURL(`${process.cwd()}/.sites-runtime/publishing-${name}.mjs`));
const [records, media, publish, due, drive] = await Promise.all(['records', 'media', 'publish', 'due', 'drive'].map(load));

// ---- Meta and Supabase, stubbed: every call recorded, answers scripted per test.
const calls = [];
const containerStatus = new Map();   // containerId → status_code
let failNext = null;                 // { match: RegExp, message } → that call answers with a Meta error
let containers = 0, photos = 0;
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
  if (u.startsWith('https://drive.usercontent.google.com/download')) {
    // Drive: a public JPEG, a public PNG, a public MP4, or a private file (an HTML sign-in page).
    const id = new URL(u).searchParams.get('id');
    calls.push({ service: 'drive', method, id });
    const files = { PublicJpegFile000000001: ['image/jpeg', 'croissant.jpg'], PublicPngFile00000000001: ['image/png', 'logo.png'], PublicVideoFile00000001: ['video/mp4', 'reel.mp4'] };
    const found = files[id];
    return found
      ? new Response('bytes', { status: 200, headers: { 'Content-Type': found[0], 'Content-Disposition': `attachment; filename="${found[1]}"` } })
      : new Response('<html>Sign in</html>', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  if (!u.startsWith('https://graph.facebook.com/')) return realFetch(url, init);
  const path = u.slice('https://graph.facebook.com/v21.0/'.length);
  calls.push({ service: 'meta', method, path, body, auth: init.headers?.Authorization });
  if (failNext && failNext.match.test(`${method} ${path}`)) {
    const message = failNext.message; failNext = null;
    return reply({ error: { code: 100, message: 'Invalid parameter', error_user_msg: message } }, 400);
  }
  if (method === 'GET' && /\?fields=access_token$/.test(path)) return reply(path.startsWith('0000000000') ? { id: '0' } : { access_token: 'page-token' });
  if (method === 'POST' && /\/photos$/.test(path)) return body.published === false ? reply({ id: `photo-${++photos}` }) : reply({ id: 'photo1', post_id: `${path.split('/')[0]}_777` });
  if (method === 'POST' && /\/feed$/.test(path)) return reply({ id: `${path.split('/')[0]}_888` });
  if (method === 'POST' && /\/videos$/.test(path)) return reply({ id: 'video1' });
  if (method === 'POST' && /\/media$/.test(path)) {
    const id = `${body.is_carousel_item ? 'child' : 'container'}-${++containers}`;
    containerStatus.set(id, body.media_type === 'REELS' || (body.is_carousel_item && body.media_type === 'VIDEO') ? 'IN_PROGRESS' : 'FINISHED');
    return reply({ id });
  }
  if (method === 'GET' && /^(container|child)-\d+\?fields=status_code/.test(path)) return reply({ status_code: containerStatus.get(path.split('?')[0]) });
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
const view = async () => (await (await records.GET(new Request('https://space.test/api/records', { headers: { 'X-Workspace-Id': WS } }))).json()).records;
async function publishNow(postId, status = 200) {
  const r = await request(publish, { postId }); const d = await r.json(); assert.equal(r.status, status, JSON.stringify(d)); checks++; return d;
}
async function scheduled(secret = CRON) {
  const r = await due.GET(new Request('https://space.test/api/editorial/publish-due', { headers: secret ? { Authorization: `Bearer ${secret}` } : {} }));
  return { status: r.status, body: await r.json() };
}
const casablanca = (offsetDays = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(new Date(Date.now() + offsetDays * 86_400_000));

await records.GET(new Request('https://space.test/api/records'));
const client = await post({ action: 'create', kind: 'client', data: { name: 'Kojo Bakery', facebookPageId: '1111111111', instagramId: '2222222222' } });
const noAccounts = await post({ action: 'create', kind: 'client', data: { name: 'Sans comptes' } });
const approving = await post({ action: 'create', kind: 'client', data: { name: 'Client qui valide', facebookPageId: '3333333333', instagramId: '4444444444', postApproval: true } });
const people = async (id, role, clientId = null) => {
  await pg.query('INSERT INTO users (id, name, email, password_hash) VALUES ($1, $1, $2, $3)', [id, `${id}@studio.test`, 'x']);
  await pg.query('INSERT INTO workspace_members (workspace_id, user_id, role, name, email, client_id) VALUES ($1, $2, $3, $2, $4, $5)', [WS, id, role, `${id}@studio.test`, clientId]);
  return { userId: id, fullName: id, displayName: id, email: `${id}@studio.test` };
};
const creative = await people('crea', 'creative');
const manager = await people('smm', 'social');
const approver = await people('boss', 'client', approving.id);
const stranger = await people('other', 'client', client.id);

const file = (n, type = 'image') => `ws_owner/${String(n).padStart(8, '0')}-0000-0000-0000-000000000000.${type === 'image' ? 'jpg' : 'mp4'}`;
const item = (n, type = 'image') => ({ url: `${SUPABASE}/storage/v1/object/public/editorial-media/${file(n, type)}`, type, path: file(n, type) });
const newPost = async (data, status = 200) => {
  const d = await post({ action: 'create', kind: 'editorial_post', data: { name: 'Post', clientId: client.id, due: casablanca(5), description: 'Nouvelle collection ✨', socialState: 'scheduled', ...data } }, status);
  return status === 200 ? d.records.find((r) => r.id === d.id) : d;
};
const fbIg = [{ network: 'facebook', format: 'post' }, { network: 'instagram', format: 'post' }];

// 1. Media: a signed upload straight to storage, JPEG photos and MP4/MOV videos only; Social roles only.
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
  as(creative);
  eq((await request(media, { contentType: 'image/jpeg', size: 1000 })).status, 403, 'a « Membre » does not upload for the Social hub');
  as(manager);
  eq((await request(media, { contentType: 'image/jpeg', size: 1000 })).status, 200, 'a social media manager does');
  as(owner);
  delete env.SUPABASE_URL;
  eq((await request(media, { contentType: 'image/jpeg', size: 1000 })).status, 503, 'storage not configured → a clear refusal');
  env.SUPABASE_URL = SUPABASE;
}

// 2. « Publier maintenant »: one photo to Facebook and Instagram in one click, with the answer for each.
{
  const p = await newPost({ name: 'Lancement', targets: fbIg, media: [item(1)] });
  eq([p.socialState, p.media.length, p.targets.length], ['scheduled', 1, 2], 'the post keeps its targets and media');
  calls.length = 0;
  const out = await publishNow(p.id);
  eq(out.results.facebook, { ok: true, at: out.results.facebook.at, externalId: '1111111111_777', url: 'https://www.facebook.com/1111111111_777', platform: 'Facebook' }, 'Facebook answers with the post and its link');
  eq([out.results.instagram.ok, out.results.instagram.url], [true, 'https://www.instagram.com/p/ig-container-1/'], 'Instagram answers with the permalink');
  ok(out.post.publishedAt && !out.post.publishingAt, 'every network done → published, and released');
  const photo = metaCalls().find((c) => /\/photos$/.test(c.path));
  eq([photo.path, photo.body.url, photo.body.caption, photo.auth], ['1111111111/photos', item(1).url, 'Nouvelle collection ✨', 'Bearer page-token'], 'Facebook: the client’s Page, the media, the caption, the Page’s own token');
  const container = metaCalls().find((c) => /\/media$/.test(c.path));
  eq([container.path, container.body.image_url, container.body.caption], ['2222222222/media', item(1).url, 'Nouvelle collection ✨'], 'Instagram: the client’s account, a photo with the caption');
  const feed = (await view()).find((r) => r.kind === 'event' && r.id.startsWith(`evt:${p.id}:publish:`));
  ok(feed && feed.postId === p.id && /publié sur Facebook/.test(feed.name) && /publié sur Instagram/.test(feed.name), 'the studio feed hears about it');
  calls.length = 0;
  await publishNow(p.id);
  eq(metaCalls().length, 0, 'a second click on a published post publishes nothing again');
}

// 3. A caption per network, and a network's own text wins over the shared one.
{
  const p = await newPost({ name: 'Textes', targets: [{ network: 'facebook', format: 'post', caption: 'Texte long pour Facebook' }, { network: 'instagram', format: 'post' }], media: [item(2)] });
  calls.length = 0;
  await publishNow(p.id);
  eq(metaCalls().find((c) => /\/photos$/.test(c.path)).body.caption, 'Texte long pour Facebook', 'Facebook gets its own text');
  eq(metaCalls().find((c) => /\/media$/.test(c.path)).body.caption, 'Nouvelle collection ✨', 'Instagram the shared one');
}

// 4. Formats: carousel, story, Reel, several photos on Facebook, a text-only Facebook post.
{
  const carousel = await newPost({ name: 'Carrousel', targets: [{ network: 'instagram', format: 'carousel' }], media: [item(3), item(4), item(5)] });
  calls.length = 0;
  const out = await publishNow(carousel.id);
  ok(out.results.instagram.ok, 'an Instagram carousel goes out');
  const children = metaCalls().filter((c) => c.body?.is_carousel_item);
  eq(children.map((c) => c.body.image_url), [item(3).url, item(4).url, item(5).url], 'one child per photo, in order');
  const parent = metaCalls().find((c) => c.body?.media_type === 'CAROUSEL');
  eq([parent.body.children.split(',').length, parent.body.caption], [3, 'Nouvelle collection ✨'], 'then the carousel, with its caption');

  const story = await newPost({ name: 'Story', targets: [{ network: 'instagram', format: 'story' }], media: [item(6)] });
  calls.length = 0;
  ok((await publishNow(story.id)).results.instagram.ok, 'an Instagram story goes out');
  eq(metaCalls().find((c) => /\/media$/.test(c.path)).body, { media_type: 'STORIES', image_url: item(6).url }, 'as STORIES, without a caption');

  const photos3 = await newPost({ name: 'Album', targets: [{ network: 'facebook', format: 'post' }], media: [item(7), item(8), item(9)] });
  calls.length = 0;
  const album = await publishNow(photos3.id);
  eq(metaCalls().filter((c) => c.body?.published === false).length, 3, 'Facebook: each photo uploaded unpublished…');
  const feedPost = metaCalls().find((c) => /\/feed$/.test(c.path));
  eq([feedPost.body.attached_media.length, feedPost.body.message, album.results.facebook.url], [3, 'Nouvelle collection ✨', 'https://www.facebook.com/1111111111_888'], '…then attached to a single post');

  const text = await newPost({ name: 'Texte seul', targets: [{ network: 'facebook', format: 'post' }], media: [] });
  calls.length = 0;
  ok((await publishNow(text.id)).results.facebook.ok, 'a text-only Facebook post goes out');
  eq(metaCalls().find((c) => /\/feed$/.test(c.path)).body, { message: 'Nouvelle collection ✨' }, 'as a Page post with its message');

  // What can't go out as it is is refused before Meta is called, with the reason.
  const twoPhotos = await newPost({ name: 'Mauvais format', targets: [{ network: 'instagram', format: 'post' }], media: [item(10), item(11)] });
  calls.length = 0;
  eq((await publishNow(twoPhotos.id, 400)).error, 'Instagram : Un post Instagram publie une seule photo.', 'an Instagram post with two photos is refused');
  const photoReel = await newPost({ name: 'Reel sans vidéo', targets: [{ network: 'instagram', format: 'reel' }], media: [item(12)] });
  eq((await publishNow(photoReel.id, 400)).error, 'Instagram : Un Reel publie une seule vidéo.', 'a Reel without a video is refused');
  eq(metaCalls().length, 0, 'and Meta is never called for them');
  await post({ action: 'create', kind: 'editorial_post', data: { name: 'X', clientId: client.id, due: casablanca(1), targets: [{ network: 'facebook', format: 'reel' }] } }, 400);
  await post({ action: 'create', kind: 'editorial_post', data: { name: 'X', clientId: client.id, due: casablanca(1), targets: [{ network: 'instagram', format: 'post' }, { network: 'instagram', format: 'story' }] } }, 400);
}

// 5. Partial failure: the network that can go out does; the other says exactly why; a retry works.
{
  const p = await newPost({ name: 'Sans compte', clientId: noAccounts.id, targets: [{ network: 'facebook', format: 'post' }, { network: 'tiktok', format: 'video' }], media: [item(13, 'video')] });
  const out = await publishNow(p.id);
  eq([out.results.facebook.ok, out.results.facebook.error], [false, 'Ajoutez l’identifiant de la Page Facebook sur la fiche du client.'], 'a client without a Page id is told so');
  ok(!('tiktok' in out.results), 'TikTok is not attempted: it is posted by hand for now');
  const refused = await newPost({ name: 'Refusé', targets: [{ network: 'instagram', format: 'post' }], media: [item(14)] });
  failNext = { match: /^POST 2222222222\/media$/, message: 'The aspect ratio is not supported.' };
  const failed = await publishNow(refused.id);
  eq([failed.results.instagram.ok, failed.results.instagram.error], [false, 'The aspect ratio is not supported.'], 'Meta’s own reason comes back');
  ok(failed.post.history.some((h) => h.text === 'Échec sur Instagram : The aspect ratio is not supported.'), 'and is kept in the history');
  ok((await publishNow(refused.id)).results.instagram.ok, 'a click retries a failed network right away');
}

// 6. Networks the app doesn't post to yet: marked as published by hand, then the post is done.
{
  const p = await newPost({ name: 'TikTok + Instagram', targets: [{ network: 'instagram', format: 'reel' }, { network: 'tiktok', format: 'video' }], media: [item(15, 'video')] });
  containers = 100; // the Reel container this run creates
  await publishNow(p.id);
  containerStatus.set('container-101', 'FINISHED');
  const reelDone = await publishNow(p.id);
  ok(reelDone.results.instagram.ok && !reelDone.post.publishedAt, 'Instagram done; the post waits for TikTok');
  await post({ action: 'post-mark-published', postId: p.id, network: 'instagram' }, 400);
  as(creative);
  await post({ action: 'post-mark-published', postId: p.id, network: 'tiktok' }, 403);
  as(owner);
  const marked = await post({ action: 'post-mark-published', postId: p.id, network: 'tiktok', url: 'https://www.tiktok.com/@kojo/video/1' });
  const done = marked.records.find((r) => r.id === p.id);
  eq([done.publishResults.tiktok.ok, done.publishResults.tiktok.manual, done.publishResults.tiktok.url, !!done.publishedAt], [true, true, 'https://www.tiktok.com/@kojo/video/1', true], 'marked by hand, with its link: now published');
}

// 7. Who may do what: a « Membre » neither plans nor publishes; a social media manager does both.
{
  as(creative);
  await post({ action: 'create', kind: 'editorial_post', data: { name: 'Membre', clientId: client.id, due: casablanca(3) } }, 403);
  const p = (await view()).find((r) => r.kind === 'editorial_post');
  await post({ action: 'update', kind: 'editorial_post', id: p.id, revision: p.revision, data: { name: 'Modifié', clientId: client.id, due: casablanca(3) } }, 403);
  eq((await publishNow(p.id, 403)).error, 'Le Social est réservé au propriétaire, aux administrateurs et aux social media managers.', 'nor publishes');
  await post({ action: 'delete', kind: 'editorial_post', id: p.id, revision: p.revision }, 403);
  as(manager);
  const mine = await newPost({ name: 'Par le SMM', targets: fbIg, media: [item(16)] });
  ok((await publishNow(mine.id)).results.facebook.ok, 'a social media manager publishes');
  const fresh = (await view()).find((r) => r.id === mine.id);
  await post({ action: 'delete', kind: 'editorial_post', id: fresh.id, revision: fresh.revision });
  ok(!(await view()).some((r) => r.id === mine.id), 'and deletes a post');
  as(owner);
}

// 8. Guards: no network, no configuration, a post already running.
{
  const none = await newPost({ name: 'Sans réseau', targets: [], media: [item(17)] });
  eq((await publishNow(none.id, 400)).error, 'Choisissez au moins un réseau.');
  const guarded = await newPost({ name: 'Garde', targets: [{ network: 'facebook', format: 'post' }], media: [item(18)] });
  delete env.META_PUBLISH_TOKEN;
  eq((await publishNow(guarded.id, 503)).error, 'La publication n’est pas configurée (META_PUBLISH_TOKEN).');
  env.META_PUBLISH_TOKEN = 'system-token';
  await pg.query("UPDATE records SET data = jsonb_set(data, '{publishingAt}', to_jsonb($1::text)) WHERE id = $2", [new Date().toISOString(), guarded.id]);
  calls.length = 0;
  eq((await publishNow(guarded.id, 409)).error, 'Ce post est déjà en cours de publication.', 'a post being published is held');
  eq(metaCalls().length, 0, 'and Meta is not called a second time');
  await pg.query("UPDATE records SET data = jsonb_set(data, '{publishingAt}', to_jsonb($1::text)) WHERE id = $2", [new Date(Date.now() - 11 * 60_000).toISOString(), guarded.id]);
  ok((await publishNow(guarded.id)).results.facebook.ok, 'a hold left by a run that died expires after ten minutes');
}

// 9. Internal posts go out on the studio's own accounts.
{
  const p = await newPost({ name: 'Studio', clientId: 'internal', targets: fbIg, media: [item(19)] });
  calls.length = 0;
  const out = await publishNow(p.id);
  eq(metaCalls().find((c) => /\/photos$/.test(c.path)).path, '5555555555/photos', 'the studio’s Page');
  eq(out.results.instagram.error, 'Compte Instagram du studio non configuré (META_STUDIO_INSTAGRAM_ID).', 'a missing studio account is named');
}

// 10. The client approves: scheduling asks them, they answer in the portal, changes ask again.
{
  const p = await newPost({ name: 'À valider', clientId: approving.id, targets: fbIg, media: [item(20)], due: casablanca(-1) });
  eq(p.approval?.state, 'pending', 'scheduling a post for a client who approves posts asks them');
  const draft = await newPost({ name: 'Brouillon', clientId: approving.id, targets: fbIg, media: [item(21)], socialState: 'draft' });
  ok(!draft.approval, 'a draft asks nobody');
  eq((await publishNow(p.id, 409)).error, 'Cette publication attend la validation du client.', 'nothing goes out before the answer');
  ok(!(await scheduled()).body.runs.some((r) => r.postId === p.id), 'not even when its time has come');

  as(approver);
  const portal = await view();
  ok(portal.some((r) => r.id === p.id) && !portal.some((r) => r.id === draft.id), 'the client sees the scheduled post, never the draft');
  const shown = portal.find((r) => r.id === p.id);
  ok(!shown.history && !shown.author && shown.media.every((m) => !m.path), 'without the studio’s working details');
  ok(portal.some((r) => r.kind === 'event' && r.postId === p.id && r.audience === 'client'), 'and a notification asking for approval');
  await post({ action: 'post-changes', postId: p.id, text: '' }, 400);
  as(stranger);
  await post({ action: 'post-approve', postId: p.id }, 404);
  as(approver);
  await post({ action: 'post-changes', postId: p.id, text: 'Changez la photo, merci.' });
  as(owner);
  let current = (await view()).find((r) => r.id === p.id);
  eq([current.approval.state, current.approval.note], ['changes', 'Changez la photo, merci.'], 'the client asks for a change');
  ok((await view()).some((r) => r.kind === 'event' && r.postId === p.id && r.audience === 'studio' && /demande des modifications/.test(r.name)), 'the studio hears about it');
  await post({ action: 'update', kind: 'editorial_post', id: p.id, revision: current.revision, data: { name: 'À valider', clientId: approving.id, due: casablanca(-1), description: 'Nouvelle collection ✨', socialState: 'scheduled', targets: fbIg, media: [item(22)] } });
  current = (await view()).find((r) => r.id === p.id);
  eq(current.approval.state, 'pending', 'changing the post asks the client again');
  as(approver);
  await post({ action: 'post-approve', postId: p.id });
  await post({ action: 'post-approve', postId: p.id }, 409);
  as(owner);
  current = (await view()).find((r) => r.id === p.id);
  eq([current.approval.state, current.approval.by], ['approved', 'boss'], 'approved by the client');
  const run = await scheduled();
  ok(run.body.runs.some((r) => r.postId === p.id), 'the scheduled run now sends it');
  ok((await view()).find((r) => r.id === p.id).publishedAt, 'published');

  // The studio can record an approval given elsewhere (WhatsApp…), in its own name.
  const q = await newPost({ name: 'Validé par WhatsApp', clientId: approving.id, targets: fbIg, media: [item(23)] });
  await post({ action: 'post-approve', postId: q.id });
  eq((await view()).find((r) => r.id === q.id).approval.by, 'Owner (pour le client)', 'recorded in the studio’s name');
}

// 11. The scheduled run: only scheduled posts whose time has come; Instagram videos finished later.
{
  eq((await scheduled(null)).status, 401, 'the scheduler needs CRON_SECRET');
  const fb = [{ network: 'facebook', format: 'post' }];
  const future = await newPost({ name: 'Demain', targets: fb, media: [item(30)] });
  const later = await newPost({ name: 'Ce soir', targets: fb, due: casablanca(0), time: '23:59', media: [item(31)] });
  const now = await newPost({ name: 'Ce matin', targets: fb, due: casablanca(0), time: '00:00', media: [item(32)] });
  const missed = await newPost({ name: 'Hier', targets: fb, due: casablanca(-1), media: [item(33)] });
  const old = await newPost({ name: 'Trop ancien', targets: fb, due: casablanca(-10), media: [item(34)] });
  const draft = await newPost({ name: 'Brouillon d’hier', targets: fb, due: casablanca(-1), media: [item(35)], socialState: 'draft' });
  const reel = await newPost({ name: 'Reel', targets: [{ network: 'instagram', format: 'reel' }], due: casablanca(-1), media: [item(36, 'video')] });
  const run = await scheduled();
  eq(run.status, 200, JSON.stringify(run.body));
  const ran = new Set(run.body.runs.map((r) => r.postId));
  ok(ran.has(now.id) && ran.has(missed.id), 'posts whose time has come go out, and one missed yesterday is caught up');
  ok(!ran.has(future.id) && !ran.has(later.id) && !ran.has(old.id), 'not before their date or hour, and not ten days late');
  ok(!ran.has(draft.id), 'a draft never goes out on its own');
  eq(run.body.runs.find((r) => r.postId === reel.id).platforms, { Instagram: 'pending' }, 'a video Instagram is still processing is left pending');
  const pending = (await view()).find((r) => r.id === reel.id);
  eq([pending.publishResults.instagram.pending, pending.publishedAt], [true, undefined], 'shown as in progress, not failed');
  containerStatus.set(pending.publishResults.instagram.containerId, 'FINISHED');
  calls.length = 0;
  const next = await scheduled();
  eq(next.body.runs.find((r) => r.postId === reel.id).platforms, { Instagram: 'ok' }, 'the next run publishes it once Instagram is done');
  eq(metaCalls().filter((c) => /\/media$/.test(c.path) && c.body?.video_url).length, 0, 'without uploading it a second time');
  eq((await scheduled()).body.runs.filter((r) => [now.id, missed.id, reel.id].includes(r.postId)).length, 0, 'nothing already out goes out again');

  // A carousel with a video: its children are processed first, then the carousel goes out.
  const mixed = await newPost({ name: 'Carrousel vidéo', targets: [{ network: 'instagram', format: 'carousel' }], due: casablanca(-1), media: [item(37), item(38, 'video')] });
  const first = await scheduled();
  eq(first.body.runs.find((r) => r.postId === mixed.id).platforms, { Instagram: 'pending' }, 'waits while a child video is processed');
  const waiting = (await view()).find((r) => r.id === mixed.id).publishResults.instagram;
  eq(waiting.childIds.length, 2, 'the children are remembered');
  for (const id of waiting.childIds) containerStatus.set(id, 'FINISHED');
  const second = await scheduled();
  eq(second.body.runs.find((r) => r.postId === mixed.id).platforms, { Instagram: 'ok' }, 'then the carousel is created and published');
}

// 12. Files leave storage with their post; paths outside the workspace are never kept (nor deleted).
{
  const p = await newPost({ name: 'À supprimer', targets: fbIg, media: [item(40), item(41)] });
  calls.length = 0;
  await post({ action: 'delete', kind: 'editorial_post', id: p.id, revision: p.revision });
  eq(calls.find((c) => c.service === 'storage' && c.method === 'DELETE')?.body, { prefixes: [file(40), file(41)] }, 'deleting a post removes every file');
  const q = await newPost({ name: 'Remplacé', targets: fbIg, media: [item(42), item(43)] });
  calls.length = 0;
  await post({ action: 'update', kind: 'editorial_post', id: q.id, revision: q.revision, data: { name: 'Remplacé', clientId: client.id, due: casablanca(5), targets: fbIg, media: [item(43)] } });
  eq(calls.find((c) => c.method === 'DELETE')?.body, { prefixes: [file(42)] }, 'a photo taken off the post is removed, the other kept');
  const foreign = await newPost({ name: 'Chemin étranger', targets: fbIg, media: [{ ...item(44), path: 'ws_other/00000044-0000-0000-0000-000000000000.jpg' }] });
  ok(!foreign.media[0].path, 'a path in another workspace’s folder is dropped');
  calls.length = 0;
  await post({ action: 'delete', kind: 'editorial_post', id: foreign.id, revision: foreign.revision });
  ok(!calls.some((c) => c.method === 'DELETE'), 'so deleting the post can never delete another workspace’s file');
}

// 13. A post planned before the Social hub (platform ids, one media) still publishes.
{
  const boot = await view();
  const platform = (name) => boot.find((r) => r.kind === 'platform' && r.name === name).id;
  const d = await post({ action: 'create', kind: 'editorial_post', data: { name: 'Ancien', clientId: client.id, due: casablanca(2), channels: [platform('Facebook')], mediaUrl: item(50).url, mediaType: 'image', mediaPath: file(50) } });
  const legacy = d.records.find((r) => r.id === d.id);
  eq([legacy.media.length, legacy.socialState], [1, 'draft'], 'its single media becomes the media list; it is a draft until scheduled');
  ok((await publishNow(legacy.id)).results.facebook.ok, 'its Facebook target is read from its platforms');
}

// 14. Media from Google Drive: a public file's link is checked and turned into its direct address.
{
  const fromDrive = async (link, status = 200) => { const r = await request(drive, { link }); const d = await r.json(); assert.equal(r.status, status, JSON.stringify(d)); checks++; return d; };
  const jpeg = await fromDrive('https://drive.google.com/file/d/PublicJpegFile000000001/view?usp=sharing');
  eq([jpeg.type, jpeg.mime, jpeg.name, jpeg.url], ['image', 'image/jpeg', 'croissant.jpg', 'https://drive.usercontent.google.com/download?id=PublicJpegFile000000001&export=download&confirm=t'], 'a shared photo: its direct download address, type and name');
  ok(jpeg.thumb.startsWith('https://drive.google.com/thumbnail?id=PublicJpegFile000000001'), 'and Drive’s preview for the app');
  eq((await fromDrive('https://drive.google.com/open?id=PublicVideoFile00000001')).type, 'video', 'the open?id= form works too, and a video is recognised');
  ok(/pas public/.test((await fromDrive('https://drive.google.com/file/d/PrivateFile0000000000001/view', 400)).error), 'a private file is refused with how to share it');
  ok(/dossier/.test((await fromDrive('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUv', 400)).error), 'a folder is refused');
  ok(/Collez le lien/.test((await fromDrive('https://example.com/photo.jpg', 400)).error), 'a link that is not Drive is refused');
  as(creative);
  eq((await request(drive, { link: 'https://drive.google.com/file/d/PublicJpegFile000000001/view' })).status, 403, 'Social roles only');
  as(owner);

  const drivePhoto = { url: jpeg.url, type: 'image', source: 'drive', thumb: jpeg.thumb, mime: 'image/jpeg', name: 'croissant.jpg' };
  const p = await newPost({ name: 'Depuis Drive', targets: fbIg, media: [drivePhoto] });
  eq([p.media[0].source, p.media[0].path], ['drive', undefined], 'kept as a Drive file, never as a storage path');
  calls.length = 0;
  const out = await publishNow(p.id);
  ok(out.results.facebook.ok && out.results.instagram.ok, 'it publishes to both networks');
  eq(metaCalls().find((c) => /\/media$/.test(c.path)).body.image_url, jpeg.url, 'Meta fetches the file straight from Drive');
  const png = await fromDrive('https://drive.google.com/file/d/PublicPngFile00000000001/view');
  const pngPost = await newPost({ name: 'PNG', targets: [{ network: 'instagram', format: 'post' }], media: [{ url: png.url, type: 'image', source: 'drive', thumb: png.thumb, mime: png.mime }] });
  eq((await publishNow(pngPost.id, 400)).error, 'Instagram : Instagram n’accepte que les photos JPEG : exportez l’image en .jpg dans Drive.', 'a PNG is refused for Instagram with the fix');
  calls.length = 0;
  await post({ action: 'delete', kind: 'editorial_post', id: pngPost.id, revision: pngPost.revision });
  ok(!calls.some((c) => c.service === 'storage' && c.method === 'DELETE'), 'deleting a post never touches Drive or storage for a Drive file');
}

globalThis.fetch = realFetch;
await pg.close();
console.log(`${checks} publishing checks passed: media upload, publish now, captions per network, carousels, stories, reels, Facebook albums and text, refusals, partial failures, networks by hand, roles, holds, studio accounts, client approval, schedule, Instagram processing, storage cleanup, older posts, Google Drive media.`);
