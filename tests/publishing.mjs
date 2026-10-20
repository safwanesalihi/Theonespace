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
  accounts: 'lib/editorial-publish.ts', subscription: 'lib/subscription.ts', time: 'lib/time.ts',
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
const [accounts, subscription, time] = await Promise.all(['accounts', 'subscription', 'time'].map(load));

// ---- Meta and Supabase, stubbed: every call recorded, answers scripted per test.
const calls = [];
const containerStatus = new Map();   // containerId → status_code
let failNext = null;                 // { match: RegExp, message } → that call answers with a Meta error
let containers = 0, photos = 0;
const uploads = { video_reels: 0, video_stories: 0 };
const reelPublished = { video_status: 'ready', uploading_phase: { status: 'complete' }, processing_phase: { status: 'complete' }, publishing_phase: { status: 'complete', publish_status: 'published' } };
const reelProcessing = { video_status: 'processing', uploading_phase: { status: 'complete' }, processing_phase: { status: 'in_progress' }, publishing_phase: { status: 'not_started' } };
const reelStatus = new Map();        // Facebook Reel video id → Meta's status; otherwise `reelDefault`
let reelDefault = reelPublished;
let beforeMeta = null;               // (method, path) → awaited before Meta answers
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
  if (u.startsWith('https://drive.google.com/embeddedfolderview')) {
    // A public folder's embedded view, shaped like Drive's own page: an entry per file, with its type.
    const id = new URL(u).searchParams.get('id');
    calls.push({ service: 'drive-folder', method, id });
    const entry = ([file, mime, name]) => `<div class="flip-entry" id="entry-${file}" tabindex="0" role="link"><div class="flip-entry-info"><a href="https://drive.google.com/file/d/${file}/view?usp=drive_web" target="_blank"><div class="flip-entry-list-icon"><img src="https://drive-thirdparty.googleusercontent.com/16/type/${mime}" alt=""/></div><div class="flip-entry-title">${name}</div></a></div></div>`;
    const folders = {
      PublicFolder0000000000001: [['PublicVideoFile00000001', 'video/mp4', '10.mp4'], ['DocFile00000000000000001', 'application/vnd.google-apps.document', 'Notes'], ['PublicJpegFile000000001', 'image/jpeg', '2.jpg'],
        ['SubFolder000000000000001', 'application/vnd.google-apps.folder', 'Archives'], ['PrivateFile0000000000002', 'image/jpeg', '1.jpg']],
      DocsOnlyFolder00000000001: [['DocFile00000000000000001', 'application/vnd.google-apps.document', 'Notes']],
    };
    const found = folders[id];
    return found
      ? new Response(`<html><body><div class="flip-entries">${found.map(entry).join('')}</div></body></html>`, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
      : new Response('<html>Not found</html>', { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  if (u.startsWith('https://rupload.facebook.com/')) {
    calls.push({ service: 'rupload', method, url: u, fileUrl: init.headers?.file_url, auth: init.headers?.Authorization });
    return reply({ success: true });
  }
  if (!u.startsWith('https://graph.facebook.com/')) return realFetch(url, init);
  const path = u.slice('https://graph.facebook.com/v21.0/'.length);
  calls.push({ service: 'meta', method, path, body, auth: init.headers?.Authorization });
  if (beforeMeta) await beforeMeta(method, path);
  if (failNext && failNext.match.test(`${method} ${path}`)) {
    const message = failNext.message; failNext = null;
    return reply({ error: { code: 100, message: 'Invalid parameter', error_user_msg: message } }, 400);
  }
  if (method === 'GET' && /\?fields=access_token$/.test(path)) return reply(path.startsWith('0000000000') ? { id: '0' } : { access_token: 'page-token' });
  if (method === 'POST' && /\/photos$/.test(path)) return body.published === false ? reply({ id: `photo-${++photos}` }) : reply({ id: 'photo1', post_id: `${path.split('/')[0]}_777` });
  if (method === 'POST' && /\/feed$/.test(path)) return reply({ id: `${path.split('/')[0]}_888` });
  if (method === 'POST' && /\/videos$/.test(path)) return reply({ id: 'video1' });
  if (method === 'POST' && /\/(video_reels|video_stories)$/.test(path)) {
    const edge = path.split('/')[1];
    if (body.upload_phase === 'start') {
      const id = `${edge}-${++uploads[edge]}`;
      if (edge === 'video_reels' && !reelStatus.has(id)) reelStatus.set(id, reelDefault);
      return reply({ video_id: id, upload_url: `https://rupload.facebook.com/video-upload/v21.0/${id}` });
    }
    return reply(edge === 'video_stories' ? { success: true, post_id: 'vstory-post-1' } : { success: true });
  }
  if (method === 'GET' && /^video_reels-\d+\?fields=status$/.test(path)) return reply({ status: reelStatus.get(path.split('?')[0]) });
  if (method === 'POST' && /\/photo_stories$/.test(path)) return reply({ success: true, post_id: `pstory-${body.photo_id}` });
  if (method === 'POST' && /\/media$/.test(path)) {
    const id = `${body.is_carousel_item ? 'child' : 'container'}-${++containers}`;
    containerStatus.set(id, body.media_type === 'REELS' || (body.media_type === 'STORIES' && body.video_url) || (body.is_carousel_item && body.media_type === 'VIDEO') ? 'IN_PROGRESS' : 'FINISHED');
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
// The app's own Casablanca clock (lib/time.ts), not Node's zone data: they disagree when Node's is older
// than Morocco's last change, and the scheduler decides by the app's clock.
const casablanca = (offsetDays = 0) => time.appDayKey(new Date(Date.now() + offsetDays * 86_400_000));

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
  eq((await request(media, { contentType: 'image/jpeg', size: 1000 }, { workspace: 'ws:owner:print' })).status, 403, 'never the retired print workspace');
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
  await post({ action: 'create', kind: 'editorial_post', data: { name: 'X', clientId: client.id, due: casablanca(1), targets: [{ network: 'facebook', format: 'carousel' }] } }, 400);
  await post({ action: 'create', kind: 'editorial_post', data: { name: 'X', clientId: client.id, due: casablanca(1), targets: [{ network: 'instagram', format: 'post' }, { network: 'instagram', format: 'story' }] } }, 400);
}

// 4b. Facebook Reels and stories.
{
  const reel = await newPost({ name: 'Reel Facebook', targets: [{ network: 'facebook', format: 'reel' }], media: [item(40, 'video')] });
  calls.length = 0;
  const out = await publishNow(reel.id);
  eq([out.results.facebook.ok, out.results.facebook.externalId, out.results.facebook.url], [true, 'video_reels-1', 'https://www.facebook.com/reel/video_reels-1'], 'a Facebook Reel goes out, with its link');
  const reelCalls = calls.filter((c) => c.service === 'meta' && /\/video_reels$/.test(c.path));
  eq(reelCalls.map((c) => [c.path, c.body.upload_phase, c.auth]), [['1111111111/video_reels', 'start', 'Bearer page-token'], ['1111111111/video_reels', 'finish', 'Bearer page-token']], 'an upload session opened then finished on the client’s Page');
  eq([reelCalls[1].body.video_id, reelCalls[1].body.video_state, reelCalls[1].body.description], ['video_reels-1', 'PUBLISHED', 'Nouvelle collection ✨'], 'finished as published, with the caption');
  const upload = calls.find((c) => c.service === 'rupload');
  eq([upload.url, upload.fileUrl, upload.auth], ['https://rupload.facebook.com/video-upload/v21.0/video_reels-1', item(40, 'video').url, 'OAuth page-token'], 'Meta fetches the video from its public URL');

  const photoStory = await newPost({ name: 'Story photo Facebook', targets: [{ network: 'facebook', format: 'story' }], media: [item(41)] });
  calls.length = 0;
  const ps = await publishNow(photoStory.id);
  ok(ps.results.facebook.ok, 'a Facebook photo story goes out');
  eq(metaCalls().map((c) => [c.path, c.body]).filter(([p]) => /photo/.test(p)), [['1111111111/photos', { url: item(41).url, published: false }], ['1111111111/photo_stories', { photo_id: 'photo-4' }]], 'the photo uploaded unpublished, then made a story, without a caption');
  eq(ps.results.facebook.externalId, 'pstory-photo-4', 'answered with the story');

  const videoStory = await newPost({ name: 'Story vidéo Facebook', targets: [{ network: 'facebook', format: 'story' }], media: [item(42, 'video')] });
  calls.length = 0;
  const vs = await publishNow(videoStory.id);
  eq([vs.results.facebook.ok, vs.results.facebook.externalId], [true, 'vstory-post-1'], 'a Facebook video story goes out');
  const finish = metaCalls().find((c) => /\/video_stories$/.test(c.path) && c.body.upload_phase === 'finish');
  eq(finish.body, { upload_phase: 'finish', video_id: 'video_stories-1' }, 'through an upload session, without a caption');

  const photoReel = await newPost({ name: 'Reel Facebook sans vidéo', targets: [{ network: 'facebook', format: 'reel' }], media: [item(43)] });
  const elevenStories = await newPost({ name: 'Onze stories', targets: [{ network: 'facebook', format: 'story' }], media: Array.from({ length: 11 }, (_, i) => item(60 + i)) });
  calls.length = 0;
  eq((await publishNow(photoReel.id, 400)).error, 'Facebook : Un Reel publie une seule vidéo.', 'a Facebook Reel without a video is refused');
  eq((await publishNow(elevenStories.id, 400)).error, 'Facebook : Des stories : de 1 à 10 photos ou vidéos, chacune dans sa story.', 'more than ten stories at once are refused');
  eq(metaCalls().length, 0, 'and Meta is never called for them');
}

// 4d. Several photos or videos as stories: each one its own story, in order, in one click — and a
// run that stops half-way never sends a story twice.
{
  const stories = [{ network: 'instagram', format: 'story' }, { network: 'facebook', format: 'story' }];
  const three = await newPost({ name: 'Trois stories', targets: stories, media: [item(80), item(81), item(82)] });
  calls.length = 0;
  const out = await publishNow(three.id);
  eq([out.results.instagram.ok, out.results.facebook.ok, !!out.post.publishedAt], [true, true, true], 'three stories on each network, in one click');
  const igContainers = metaCalls().filter((c) => c.path === '2222222222/media');
  eq(igContainers.map((c) => c.body), [80, 81, 82].map((n) => ({ media_type: 'STORIES', image_url: item(n).url })), 'Instagram: one story container per photo, in order, without a caption');
  eq(metaCalls().filter((c) => /media_publish$/.test(c.path)).map((c) => c.body.creation_id), igContainers.map((_, i) => `container-${containers - 2 + i}`), 'published in the same order');
  eq(out.results.instagram.storyIds.length, 3, 'the stories out are remembered');
  eq(metaCalls().filter((c) => c.path === '1111111111/photos').map((c) => c.body), [80, 81, 82].map((n) => ({ url: item(n).url, published: false })), 'Facebook: each photo uploaded, in order…');
  eq(out.results.facebook.storyIds, metaCalls().filter((c) => c.path === '1111111111/photo_stories').map((c) => `pstory-${c.body.photo_id}`), '…each made its own story');

  // A video in the middle still processing: what's before it goes out, the rest follows, in order.
  const mixed = await newPost({ name: 'Stories avec vidéo', targets: [{ network: 'instagram', format: 'story' }], media: [item(83), item(84, 'video'), item(85)] });
  calls.length = 0;
  let run = await accounts.publishPost(WS, mixed.id, { manual: true, waitMs: 0 });
  const waiting = run.results.instagram;
  eq([waiting.pending, waiting.storyIds.length, waiting.childIds.length], [true, 1, 2], 'the first story is out, the video is processing, the last waits its turn');
  eq(metaCalls().filter((c) => /media_publish$/.test(c.path)).length, 1, 'nothing published out of order');
  containerStatus.set(waiting.childIds[0], 'FINISHED');
  calls.length = 0;
  const followed = await (await request(publish, { postId: mixed.id, follow: true })).json();
  eq([followed.results.instagram.ok, followed.results.instagram.storyIds.length], [true, 3], 'the hub finishes the other two');
  eq(metaCalls().filter((c) => c.path === '2222222222/media').length, 0, 'without creating any story again');

  // Facebook refuses the second story: the first stays out, and a retry sends only what's left.
  const partial = await newPost({ name: 'Stories en partie', targets: [{ network: 'facebook', format: 'story' }], media: [item(86), item(87), item(88)] });
  let storyCalls = 0;
  beforeMeta = async (method, path) => { if (path === '1111111111/photo_stories' && ++storyCalls === 2) failNext = { match: /photo_stories$/, message: 'Photo too small.' }; };
  run = await accounts.publishPost(WS, partial.id, { manual: true, waitMs: 0 });
  beforeMeta = null;
  eq([run.results.facebook.ok, run.results.facebook.error, run.results.facebook.storyIds.length], [false, 'Story 2 : Photo too small.', 1], 'which story failed, and why; the first one is kept');
  calls.length = 0;
  const retried = await publishNow(partial.id);
  eq([retried.results.facebook.ok, retried.results.facebook.storyIds.length], [true, 3], 'a click sends the rest');
  eq(metaCalls().filter((c) => c.path === '1111111111/photos').map((c) => c.body.url), [item(87).url, item(88).url], 'never the first one again');

  // Out of time between two stories: the next run goes on from there.
  const late = await newPost({ name: 'Stories sans temps', targets: [{ network: 'facebook', format: 'story' }], media: [item(89), item(90)] });
  const realNow = Date.now;
  let skew = 0;
  Date.now = () => realNow() + skew;
  beforeMeta = async (method, path) => { if (path === '1111111111/photo_stories') skew = 120_000; }; // the first story took two minutes
  run = await accounts.publishPost(WS, late.id, { manual: true, waitMs: 0, startBy: realNow() + 60_000 });
  beforeMeta = null; Date.now = realNow;
  eq([run.results.facebook.pending, run.results.facebook.storyIds.length], [true, 1], 'out of time after the first story: the second waits');
  calls.length = 0;
  const next = await scheduled();
  eq(next.body.runs.find((r) => r.postId === late.id).platforms, { Facebook: 'ok' }, 'the next run sends it');
  eq(metaCalls().filter((c) => c.path === '1111111111/photos').map((c) => c.body.url), [item(90).url], 'only the one left');
}

// 4c. A Facebook Reel counts as published only once Meta has processed it; its refusal comes back.
{
  const fbReel = [{ network: 'facebook', format: 'reel' }];
  const slow = await newPost({ name: 'Reel en traitement', targets: fbReel, media: [item(46, 'video')] });
  reelDefault = reelProcessing;
  let run = await accounts.publishPost(WS, slow.id, { manual: true, waitMs: 0 });
  reelDefault = reelPublished;
  const videoId = run.results.facebook.containerId;
  eq([run.results.facebook.ok, run.results.facebook.pending, /^video_reels-\d+$/.test(videoId), run.post.publishedAt], [false, true, true, undefined], 'a Reel Meta is still processing is in progress, not published');
  // The hub asks again (« follow »): once Meta is done, published with its link, never uploaded twice.
  reelStatus.set(videoId, reelPublished);
  calls.length = 0;
  const followed = await (await request(publish, { postId: slow.id, follow: true })).json();
  eq([followed.results.facebook.ok, followed.results.facebook.url, !!followed.post.publishedAt], [true, `https://www.facebook.com/reel/${videoId}`, true], 'published once Meta says so');
  eq(calls.filter((c) => c.service === 'rupload' || /\/video_reels$/.test(c.path ?? '')).length, 0, 'without a second upload');

  // Meta refuses the video after the upload: its reason comes back, and nothing is called published.
  const low = await newPost({ name: 'Reel refusé', targets: fbReel, media: [item(47, 'video')] });
  reelDefault = { video_status: 'processing', uploading_phase: { status: 'complete' }, processing_phase: { status: 'not_started', error: { message: 'Resolution too low. Video must have minimum 540p.' } }, publishing_phase: { status: 'not_started' } };
  run = await accounts.publishPost(WS, low.id, { manual: true, waitMs: 0 });
  reelDefault = reelPublished;
  const refusal = 'Facebook a refusé le Reel : Resolution too low. Video must have minimum 540p.';
  eq([run.results.facebook.ok, run.results.facebook.error, run.post.publishedAt], [false, refusal, undefined], 'Meta’s reason comes back');
  ok(run.post.history.some((h) => h.text === `Échec sur Facebook : ${refusal}`), 'and is kept in the history');
  // « follow » finishes what is pending and never retries a failure before its delay; a click does.
  calls.length = 0;
  const followedFailure = await (await request(publish, { postId: low.id, follow: true })).json();
  eq([Object.keys(followedFailure.results), metaCalls().length], [[], 0], 'following a refused Reel sends nothing');
  ok((await publishNow(low.id)).results.facebook.ok, 'a click sends it again');

  // Still not confirmed an hour later: reported, so someone checks the Page before sending it again.
  const stuck = await newPost({ name: 'Reel bloqué', targets: fbReel, media: [item(48, 'video')] });
  reelDefault = reelProcessing;
  await accounts.publishPost(WS, stuck.id, { manual: true, waitMs: 0 });
  reelDefault = reelPublished;
  run = await accounts.publishPost(WS, stuck.id, { now: new Date(Date.now() + 61 * 60_000), waitMs: 0 });
  eq(run.results.facebook.error, 'Facebook n’a pas confirmé le Reel après une heure : vérifiez sur la Page avant de le relancer.', 'unconfirmed after an hour: reported');

  // Each network is saved as soon as it is done: when Instagram starts, Facebook is already recorded,
  // so a run stopped half-way never loses — nor sends twice — what went out.
  const both = await newPost({ name: 'Deux réseaux', targets: fbIg, media: [item(49)] });
  let seen;
  beforeMeta = async (method, path) => {
    if (method === 'POST' && path === '2222222222/media') seen = (await pg.query('SELECT data FROM records WHERE id = $1', [both.id])).rows[0].data.publishResults;
  };
  await publishNow(both.id);
  beforeMeta = null;
  eq(seen?.facebook?.ok, true, 'Facebook saved before Instagram starts');

  // Out of time: no network is started, the post is released, and the next run sends it.
  const late = await newPost({ name: 'Plus de temps', targets: fbIg, media: [item(50)] });
  calls.length = 0;
  run = await accounts.publishPost(WS, late.id, { startBy: Date.now() - 1 });
  eq([Object.keys(run.results).length, metaCalls().length, run.post.publishingAt, run.post.publishedAt], [0, 0, undefined, undefined], 'out of time: nothing started, the post released');
  ok((await publishNow(late.id)).post.publishedAt, 'the next run publishes it');
}

// 5. Partial failure: the network that can go out does; the other says exactly why; a retry works.
{
  const p = await newPost({ name: 'Sans compte', clientId: noAccounts.id, targets: [{ network: 'facebook', format: 'post' }, { network: 'tiktok', format: 'video' }], media: [item(13, 'video')] });
  const out = await publishNow(p.id);
  eq([out.results.facebook.ok, out.results.facebook.error], [false, 'Connectez le compte Facebook de ce client (onglet Social → Comptes).'], 'a client without a connected Page is told to connect it');
  eq(out.results.tiktok.error, 'Connectez le compte TikTok de ce client (onglet Social → Comptes).', 'and the same for TikTok');
  const refused = await newPost({ name: 'Refusé', targets: [{ network: 'instagram', format: 'post' }], media: [item(14)] });
  failNext = { match: /^POST 2222222222\/media$/, message: 'The aspect ratio is not supported.' };
  const failed = await publishNow(refused.id);
  eq([failed.results.instagram.ok, failed.results.instagram.error], [false, 'The aspect ratio is not supported.'], 'Meta’s own reason comes back');
  ok(failed.post.history.some((h) => h.text === 'Échec sur Instagram : The aspect ratio is not supported.'), 'and is kept in the history');
  ok((await publishNow(refused.id)).results.instagram.ok, 'a click retries a failed network right away');
}

// 6. A network published some other way (here TikTok, not connected): marked by hand, then the post is done.
{
  const p = await newPost({ name: 'TikTok + Instagram', targets: [{ network: 'instagram', format: 'reel' }, { network: 'tiktok', format: 'video' }], media: [item(15, 'video')] });
  containers = 100; // the Reel container this run creates
  await publishNow(p.id);
  containerStatus.set('container-101', 'FINISHED');
  const reelDone = await publishNow(p.id);
  ok(reelDone.results.instagram.ok && !reelDone.post.publishedAt, 'Instagram done; the post waits for TikTok');
  ok(/Connectez le compte TikTok/.test(reelDone.post.publishResults.tiktok.error), 'TikTok says it needs connecting');
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
  eq((await publishNow(guarded.id)).results.facebook.error, 'Connectez le compte Facebook de ce client (onglet Social → Comptes).', 'no connected account and no older setup: connect it');
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
  eq(out.results.instagram.error, 'Connectez le compte Instagram du studio (Social → Comptes → Agence).', 'a missing studio account is named');
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

  // A Facebook Reel Meta is still processing: in progress, then confirmed by the next run.
  const fbReel = await newPost({ name: 'Reel Facebook planifié', targets: [{ network: 'facebook', format: 'reel' }], due: casablanca(-1), media: [item(39, 'video')] });
  reelDefault = reelProcessing;
  const sent = await scheduled();
  reelDefault = reelPublished;
  eq(sent.body.runs.find((r) => r.postId === fbReel.id).platforms, { Facebook: 'pending' }, 'a Reel Meta is processing is left pending');
  reelStatus.set((await view()).find((r) => r.id === fbReel.id).publishResults.facebook.containerId, reelPublished);
  calls.length = 0;
  eq((await scheduled()).body.runs.find((r) => r.postId === fbReel.id).platforms, { Facebook: 'ok' }, 'the next run sees it published');
  eq(calls.filter((c) => c.service === 'rupload').length, 0, 'without uploading it again');

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
  // A folder's link: every photo and video in it, in name order, each checked like a pasted file.
  const folder = await fromDrive('https://drive.google.com/drive/folders/PublicFolder0000000000001?usp=sharing');
  eq(folder.files.map((f) => [f.name, f.type]), [['croissant.jpg', 'image'], ['reel.mp4', 'video']], 'its photos and videos, « 2 » before « 10 »; documents and sub-folders left out');
  eq([folder.files[0].url, folder.skipped], ['https://drive.usercontent.google.com/download?id=PublicJpegFile000000001&export=download&confirm=t', 1], 'each by its direct address; a private file inside is counted, not added');
  ok(/pas public/.test((await fromDrive('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUv', 400)).error), 'a private folder is refused with how to share it');
  ok(/ni photo ni vidéo/.test((await fromDrive('https://drive.google.com/drive/u/0/folders/DocsOnlyFolder00000000001', 400)).error), 'a folder without media says so');
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

// 15. The studio's system token belongs to the studio's own workspaces: a company workspace (ws:org:*) never acts through it.
{
  const clientRow = { id: 'kojo', kind: 'client', name: 'Kojo', facebookPageId: '1111111111', instagramId: '2222222222' };
  const clientPost = { id: 'p1', kind: 'editorial_post', clientId: 'kojo' };
  const studioPost = { id: 'p2', kind: 'editorial_post', clientId: 'internal' };
  const account = (workspace, network, post) => accounts.accountFor(workspace, { network, format: 'post' }, post, post.clientId === 'kojo' ? clientRow : undefined, new Date());
  eq(await account(WS, 'facebook', clientPost), { accountId: '1111111111' }, 'the studio’s workspace still posts on the client’s Page with the system token');
  eq(await account(WS, 'instagram', clientPost), { accountId: '2222222222' }, '…and on its Instagram account');
  eq(await account(WS, 'facebook', studioPost), { accountId: '5555555555' }, '…and the studio’s own Page for an internal post');
  for (const [network, post] of [['facebook', clientPost], ['instagram', clientPost], ['facebook', studioPost]]) {
    const refused = await account('ws:org:acme', network, post);
    ok('error' in refused && !('accountId' in refused), `a company workspace never falls back to the system token (${network}, ${post.clientId})`);
  }
}

// 16. The scheduled run leaves a suspended company alone, and still serves an active one.
{
  // Nothing left to send in the studio's own workspace, so the per-run cap can't hide the companies.
  await pg.query("UPDATE records SET data = jsonb_set(data, '{socialState}', '\"draft\"') WHERE workspace_id = $1 AND kind = 'editorial_post'", [WS]);
  for (const [id, name] of [['ws:org:active', 'Active Co'], ['ws:org:canceled', 'Canceled Co']]) {
    await pg.query('INSERT INTO workspaces (id, name, created_by) VALUES ($1, $2, $3)', [id, name, 'owner']);
    await subscription.startTrial(id);
    const post = { id: `due-${id}`, kind: 'editorial_post', revision: 1, name: 'Due', clientId: 'internal', due: casablanca(-1), socialState: 'scheduled', description: 'x', targets: [{ network: 'facebook', format: 'post' }], media: [] };
    await pg.query("INSERT INTO records (id, owner, workspace_id, kind, data) VALUES ($1, 'owner', $2, 'editorial_post', $3::jsonb)", [post.id, id, JSON.stringify(post)]);
  }
  await pg.query("UPDATE subscriptions SET canceled = true WHERE workspace_id = 'ws:org:canceled'");
  const run = await scheduled();
  eq(run.status, 200, JSON.stringify(run.body));
  ok(run.body.runs.some((r) => r.workspaceId === 'ws:org:active' && r.postId === 'due-ws:org:active'), 'an active company’s due post is picked up');
  ok(!run.body.runs.some((r) => r.workspaceId === 'ws:org:canceled'), 'a canceled company is skipped');
  const untouched = (await pg.query("SELECT data FROM records WHERE id = 'due-ws:org:canceled'")).rows[0].data;
  ok(!untouched.publishResults && !untouched.publishingAt && !untouched.publishedAt, 'and its post was not claimed or published');
}

globalThis.fetch = realFetch;
await pg.close();
console.log(`${checks} publishing checks passed: media upload, publish now, captions per network, carousels, stories, reels, Facebook albums and text, refusals, partial failures, networks by hand, roles, holds, studio accounts, client approval, schedule, Instagram processing, storage cleanup, older posts, Google Drive media.`);
