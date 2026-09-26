// « Connecter »: a client's Facebook Page + Instagram, TikTok and YouTube, linked by logging into the
// platform — the signed round trip, choosing the Page, encrypted storage, publishing with the connected
// accounts (TikTok and YouTube uploads included), token refresh, disconnecting.
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
globalThis.testEnv = env; // bound once by every bundle below: edited in place, never replaced
const bundle = async (entry, out) => {
  await esbuild.build({ entryPoints: [entry], outfile: `.sites-runtime/${out}`, bundle: true, platform: 'node', format: 'esm', plugins: [testRuntimePlugin({ auth: false })] });
  return import(pathToFileURL(`${process.cwd()}/.sites-runtime/${out}`));
};
const records = await bundle('app/api/records/route.ts', 'connect-records.mjs');
const connect = await bundle('app/api/social/connect/[provider]/route.ts', 'connect-start.mjs');
const callback = await bundle('app/api/social/callback/[provider]/route.ts', 'connect-callback.mjs');
const accountsRoute = await bundle('app/api/social/accounts/route.ts', 'connect-accounts.mjs');
const publish = await bundle('app/api/editorial/publish/route.ts', 'connect-publish.mjs');
const box = await bundle('lib/secret-box.ts', 'connect-box.mjs');
const lib = await bundle('lib/social-accounts.ts', 'connect-lib.mjs');

// ---- the platforms, stubbed
const calls = [];
const realFetch = globalThis.fetch;
const reply = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
let tiktokTokens = 0;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url), method = init.method || 'GET';
  const auth = init.headers?.Authorization || init.headers?.authorization;
  const text = typeof init.body === 'string' ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : undefined;
  calls.push({ method, url: u, auth, body: text, headers: init.headers, size: init.body?.byteLength });
  if (u.startsWith('https://graph.facebook.com/v21.0/oauth/access_token')) return reply({ access_token: u.includes('fb_exchange_token') ? 'long-user-token' : 'short-user-token' });
  if (u.startsWith('https://graph.facebook.com/v21.0/me/accounts')) return reply({ data: [
    { id: '1111', name: 'Kojo Bakery', access_token: 'page-token-1111', picture: { data: { url: 'https://fb.test/kojo.jpg' } }, instagram_business_account: { id: '2222', username: 'kojo', profile_picture_url: 'https://ig.test/kojo.jpg' } },
    { id: '9999', name: 'Autre Page', access_token: 'page-token-9999' },
  ] });
  if (u.startsWith('https://graph.facebook.com/')) {
    const path = u.slice('https://graph.facebook.com/v21.0/'.length);
    if (/\/photos$/.test(path)) return reply({ id: 'photo1', post_id: `${path.split('/')[0]}_777` });
    if (/\/media$/.test(path)) return reply({ id: 'container-1' });
    if (/^container-1\?fields=status_code/.test(path)) return reply({ status_code: 'FINISHED' });
    if (/\/media_publish$/.test(path)) return reply({ id: 'ig-post' });
    if (/\?fields=permalink$/.test(path)) return reply({ permalink: 'https://www.instagram.com/p/ig-post/' });
    return reply({ error: { message: `unexpected ${method} ${path}` } }, 500);
  }
  if (u === 'https://open.tiktokapis.com/v2/oauth/token/') {
    tiktokTokens++;
    return reply({ access_token: `tt-access-${tiktokTokens}`, refresh_token: `tt-refresh-${tiktokTokens}`, open_id: 'tt-open-id', expires_in: 86400, refresh_expires_in: 31536000 });
  }
  if (u.startsWith('https://open.tiktokapis.com/v2/user/info/')) return reply({ data: { user: { display_name: 'Kojo TikTok', avatar_url: 'https://tt.test/a.jpg' } }, error: { code: 'ok' } });
  if (u.endsWith('/creator_info/query/')) return reply({ data: { privacy_level_options: ['SELF_ONLY'] }, error: { code: 'ok' } });
  if (u.endsWith('/video/init/')) return reply({ data: { publish_id: 'tt-publish-1', upload_url: 'https://upload.tiktok.test/u1' }, error: { code: 'ok' } });
  if (u.startsWith('https://upload.tiktok.test/')) return new Response(null, { status: 201 });
  if (u.endsWith('/status/fetch/')) return reply({ data: { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: [7123] }, error: { code: 'ok' } });
  if (u === 'https://oauth2.googleapis.com/token') return reply({ access_token: 'yt-access', refresh_token: 'yt-refresh', expires_in: 3600 });
  if (u.startsWith('https://www.googleapis.com/youtube/v3/channels')) return reply({ items: [{ id: 'UC123', snippet: { title: 'Kojo TV', customUrl: '@kojotv', thumbnails: { default: { url: 'https://yt.test/c.jpg' } } } }] });
  if (u.startsWith('https://www.googleapis.com/upload/youtube/v3/videos')) return new Response('{}', { status: 200, headers: { Location: 'https://upload.youtube.test/session-1' } });
  if (u === 'https://upload.youtube.test/session-1') return reply({ id: 'yt-video-1' });
  if (u.startsWith('https://drive.usercontent.google.com/download')) return new Response(new Uint8Array(1024), { status: 200, headers: { 'Content-Type': 'video/mp4', 'Content-Length': '1024' } });
  return realFetch(url, init);
};
const hit = (pattern) => calls.filter((c) => pattern.test(c.url));

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
const accounts = async (query = '') => (await accountsRoute.GET(new Request(`${B}/api/social/accounts${query}`, { headers: { 'X-Workspace-Id': WS } }))).json();
const accountsPost = async (body, status = 200) => {
  const r = await accountsRoute.POST(new Request(`${B}/api/social/accounts`, { method: 'POST', headers: { 'Content-Type': 'application/json', origin: B, 'X-Workspace-Id': WS }, body: JSON.stringify(body) }));
  const d = await r.json(); assert.equal(r.status, status, JSON.stringify(d)); checks++; return d;
};
const start = (provider, clientId) => connect.GET(new Request(`${B}/api/social/connect/${provider}?clientId=${clientId}&workspace=${encodeURIComponent(WS)}`), { params: Promise.resolve({ provider }) });
const back = (provider, query, cookie) => callback.GET(new Request(`${B}/api/social/callback/${provider}?${new URLSearchParams(query)}`, { headers: cookie ? { cookie } : {} }), { params: Promise.resolve({ provider }) });
/** « Connecter » then the platform's answer, as a browser would: the state from the redirect, the nonce from the cookie. */
async function login(provider, clientId, extra = {}) {
  const r = await start(provider, clientId);
  const location = new URL(r.headers.get('location'));
  const cookie = r.headers.get('set-cookie').split(';')[0];
  return back(provider, { code: 'the-code', state: location.searchParams.get('state'), ...extra }, cookie);
}

await records.GET(new Request(`${B}/api/records`));
const client = await post({ action: 'create', kind: 'client', data: { name: 'Kojo Bakery' } });
await pg.query("INSERT INTO users (id, name, email, password_hash) VALUES ('crea', 'Yasmine', 'y@studio.test', 'x'), ('smm', 'Sara', 's@studio.test', 'x')");
await pg.query("INSERT INTO workspace_members (workspace_id, user_id, role, name, email) VALUES ($1, 'crea', 'creative', 'Yasmine', 'y@studio.test'), ($1, 'smm', 'social', 'Sara', 's@studio.test')", [WS]);
const creative = { userId: 'crea', fullName: 'Yasmine', displayName: 'Yasmine', email: 'y@studio.test' };
const smm = { userId: 'smm', fullName: 'Sara', displayName: 'Sara', email: 's@studio.test' };

// 1. Tokens are encrypted; the login state is signed, single-use by its cookie, and short-lived.
{
  const sealed = box.seal('page-token-secret');
  ok(!sealed.includes('page-token-secret') && box.open(sealed) === 'page-token-secret', 'a token is stored encrypted and read back');
  assert.throws(() => box.open(sealed.slice(0, -2) + 'AA')); checks++;
  const { state, nonce } = lib.newState(WS, client.id, 'owner', 'meta');
  eq(lib.readState(state, nonce, 'meta')?.c, client.id, 'a genuine state is accepted');
  eq(lib.readState(state, 'another-nonce', 'meta'), null, 'not with another browser’s cookie');
  eq(lib.readState(state, nonce, 'tiktok'), null, 'not for another platform');
  eq(lib.readState(state.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')), nonce, 'meta'), null, 'not tampered with');
  eq(lib.readState(state, nonce, 'meta', Date.now() + 16 * 60_000), null, 'not after 15 minutes');
}

// 2. « Connecter » before the studio registered the platform's app: a clear message, back in the app.
{
  const r = await start('meta', client.id);
  eq(r.status, 303);
  const to = new URL(r.headers.get('location'));
  ok(to.origin === B && /n’est pas encore activée/.test(to.searchParams.get('social_error')) && to.hash === `#client/${client.id}/editorial`, 'back on the client’s Social tab with what to do');
  env.META_APP_ID = 'meta-app'; env.META_APP_SECRET = 'meta-secret';
  env.TIKTOK_CLIENT_KEY = 'tt-key'; env.TIKTOK_CLIENT_SECRET = 'tt-secret';
  env.GOOGLE_CLIENT_ID = 'g-id.apps.googleusercontent.com'; env.GOOGLE_CLIENT_SECRET = 'g-secret';
  const go = await start('meta', client.id);
  const dialog = new URL(go.headers.get('location'));
  eq([dialog.origin + dialog.pathname, dialog.searchParams.get('client_id'), dialog.searchParams.get('redirect_uri')], ['https://www.facebook.com/v21.0/dialog/oauth', 'meta-app', `${B}/api/social/callback/meta`], 'then straight to Facebook’s own login');
  ok(dialog.searchParams.get('scope').includes('pages_manage_posts') && dialog.searchParams.get('scope').includes('instagram_content_publish'), 'asking for posting on Pages and Instagram');
  ok(/HttpOnly; SameSite=Lax; Secure/.test(go.headers.get('set-cookie')), 'with a secure, http-only cookie for the round trip');
  as(creative);
  ok(/réservé/.test(new URL((await start('meta', client.id)).headers.get('location')).searchParams.get('social_error')), 'a « Membre » cannot connect accounts');
  as(owner);
  ok(/introuvable/.test(new URL((await start('meta', 'nope')).headers.get('location')).searchParams.get('social_error')), 'an unknown client is refused');
}

// 3. Facebook: log in, choose the client's Page among those the person manages; its Instagram comes with it.
{
  const r = await login('meta', client.id);
  const to = new URL(r.headers.get('location'));
  const nonce = to.searchParams.get('social_pick');
  ok(nonce && to.hash === `#client/${client.id}/editorial`, 'back in the app to choose the Page');
  ok(hit(/fb_exchange_token/).length === 1, 'the login is exchanged for a long-lived access');
  const listing = await accounts(`?pick=${nonce}`);
  eq(listing.pending.pages.map((p) => [p.name, p.instagram?.username]), [['Kojo Bakery', 'kojo'], ['Autre Page', undefined]], 'every Page this person manages, with its Instagram');
  ok(!JSON.stringify(listing).includes('page-token'), 'never a token in what the browser receives');
  as(smm);
  ok(!(await accounts(`?pick=${nonce}`)).pending, 'someone else can’t see or use this choice');
  await accountsPost({ action: 'pick', nonce, pageId: '1111', instagram: true }, 410);
  as(owner);
  const picked = await accountsPost({ action: 'pick', nonce, pageId: '1111', instagram: true });
  eq(picked.accounts.map((a) => [a.network, a.name, a.status]).sort(), [['facebook', 'Kojo Bakery', 'ok'], ['instagram', '@kojo', 'ok']], 'the Page and its Instagram are connected');
  await accountsPost({ action: 'pick', nonce, pageId: '1111' }, 410);
  const rows = await db.query("SELECT data FROM records WHERE starts_with(id, 'social-account:')");
  ok(rows.length === 2 && rows.every((r) => !JSON.stringify(r.data).includes('page-token-1111')), 'stored encrypted');
  const cancelled = await login('meta', client.id, { error: 'access_denied' });
  ok(/annulée/.test(new URL(cancelled.headers.get('location')).searchParams.get('social_error')), 'a cancelled login says so');
  const forged = await back('meta', { code: 'x', state: 'bad.state' }, 'the-one.social-login=abc');
  ok(/expirée ou interrompue/.test(new URL(forged.headers.get('location')).searchParams.get('social_error')), 'an answer that isn’t ours is refused');
  const r2 = await start('meta', client.id);
  const state = new URL(r2.headers.get('location')).searchParams.get('state');
  as(smm);
  const stolen = await back('meta', { code: 'x', state }, r2.headers.get('set-cookie').split(';')[0]);
  ok(/compte qui a lancé/.test(new URL(stolen.headers.get('location')).searchParams.get('social_error')), 'the answer must land in the session that asked for it');
  as(owner);
}

// 4. Publishing uses the connected Page's own access — no ids, no system token.
{
  const d = await post({ action: 'create', kind: 'editorial_post', data: { name: 'Connecté', clientId: client.id, due: '2026-12-01', description: 'Bonjour', socialState: 'scheduled',
    targets: [{ network: 'facebook', format: 'post' }, { network: 'instagram', format: 'post' }], media: [{ url: 'https://drive.usercontent.google.com/download?id=PhotoFile000000000000001&export=download&confirm=t', type: 'image', source: 'drive', mime: 'image/jpeg' }] } });
  calls.length = 0;
  const r = await publish.POST(new Request(`${B}/api/editorial/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json', origin: B, 'X-Workspace-Id': WS }, body: JSON.stringify({ postId: d.id }) }));
  const out = await r.json();
  ok(out.results.facebook.ok && out.results.instagram.ok, 'published on the connected Page and Instagram');
  ok(hit(/1111\/photos$/)[0].auth === 'Bearer page-token-1111' && hit(/2222\/media$/)[0].auth === 'Bearer page-token-1111', 'with the Page’s own access');
  eq(hit(/fields=access_token/).length, 0, 'without asking Meta for a token first');
}

// 5. TikTok: connect, then a video is uploaded and published; an expiring access is renewed on its own.
{
  const r = await login('tiktok', client.id);
  eq(new URL(r.headers.get('location')).searchParams.get('social_connected'), 'tiktok', 'TikTok connected');
  eq((await accounts()).accounts.find((a) => a.network === 'tiktok')?.name, 'Kojo TikTok', 'shown by its name');
  const video = { url: 'https://drive.usercontent.google.com/download?id=VideoFile000000000000001&export=download&confirm=t', type: 'video', source: 'drive', mime: 'video/mp4' };
  const d = await post({ action: 'create', kind: 'editorial_post', data: { name: 'TikTok', clientId: client.id, due: '2026-12-01', description: 'Le croissant 🥐', socialState: 'scheduled', targets: [{ network: 'tiktok', format: 'video' }], media: [video] } });
  calls.length = 0;
  const publishIt = async (id) => (await (await publish.POST(new Request(`${B}/api/editorial/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json', origin: B, 'X-Workspace-Id': WS }, body: JSON.stringify({ postId: id }) }))).json());
  const out = await publishIt(d.id);
  ok(out.results.tiktok.ok, 'published on TikTok');
  const init = JSON.parse(hit(/video\/init\/$/)[0].body);
  eq([init.source_info.source, init.source_info.video_size, init.source_info.total_chunk_count, init.post_info.privacy_level, init.post_info.title], ['FILE_UPLOAD', 1024, 1, 'SELF_ONLY', 'Le croissant 🥐'], 'the video is uploaded, with the audience TikTok allows and the caption');
  eq(hit(/upload\.tiktok\.test/)[0].headers['Content-Range'], 'bytes 0-1023/1024', 'in one chunk');
  ok(hit(/video\/init\/$/)[0].auth === 'Bearer tt-access-1', 'with the connected account’s access');
  // The access is about to expire: renewed with the refresh token before posting.
  const row = (await db.query("SELECT id, data FROM records WHERE id LIKE 'social-account:%:tiktok'"))[0];
  await pg.query('UPDATE records SET data = $1::jsonb WHERE id = $2', [JSON.stringify({ ...row.data, expiresAt: new Date(Date.now() - 1000).toISOString() }), row.id]);
  const d2 = await post({ action: 'create', kind: 'editorial_post', data: { name: 'TikTok 2', clientId: client.id, due: '2026-12-02', description: 'Encore', socialState: 'scheduled', targets: [{ network: 'tiktok', format: 'video' }], media: [video] } });
  calls.length = 0;
  ok((await publishIt(d2.id)).results.tiktok.ok, 'still published');
  ok(hit(/oauth\/token\/$/).length === 1 && hit(/video\/init\/$/)[0].auth === 'Bearer tt-access-2', 'after renewing the access');
  ok(!JSON.stringify((await db.query('SELECT data FROM records WHERE id = $1', [row.id]))[0].data).includes('tt-access-2'), 'the new access stored encrypted too');
}

// 6. YouTube: connect the channel, then a Short is uploaded.
{
  const r = await login('google', client.id);
  eq(new URL(r.headers.get('location')).searchParams.get('social_connected'), 'youtube', 'YouTube connected');
  const d = await post({ action: 'create', kind: 'editorial_post', data: { name: 'Short', clientId: client.id, due: '2026-12-01', description: 'Recette', socialState: 'scheduled',
    targets: [{ network: 'youtube', format: 'short', title: 'La recette du croissant' }], media: [{ url: 'https://drive.usercontent.google.com/download?id=VideoFile000000000000001&export=download&confirm=t', type: 'video', source: 'drive', mime: 'video/mp4' }] } });
  calls.length = 0;
  const out = await (await publish.POST(new Request(`${B}/api/editorial/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json', origin: B, 'X-Workspace-Id': WS }, body: JSON.stringify({ postId: d.id }) }))).json();
  eq([out.results.youtube.ok, out.results.youtube.url], [true, 'https://youtube.com/shorts/yt-video-1'], 'published as a Short, with its link');
  const meta = JSON.parse(hit(/upload\/youtube\/v3\/videos/)[0].body);
  eq([meta.snippet.title, /#Shorts/.test(meta.snippet.description), meta.status.privacyStatus], ['La recette du croissant', true, 'public'], 'with its title, marked as a Short, public');
  eq(hit(/upload\.youtube\.test/)[0].size, 1024, 'the file itself uploaded');
}

// 7. Disconnecting stops the posting; deleting the client removes its accounts.
{
  const after = await accountsPost({ action: 'disconnect', clientId: client.id, network: 'instagram' });
  ok(!after.accounts.some((a) => a.network === 'instagram'), 'Instagram disconnected');
  as(creative);
  await accountsPost({ action: 'disconnect', clientId: client.id, network: 'facebook' }, 403);
  as(owner);
  const fresh = (await post({ action: 'mark-read', ids: [] })).records.find((r) => r.id === client.id);
  await post({ action: 'delete', kind: 'client', id: client.id, revision: fresh.revision });
  eq((await db.query("SELECT id FROM records WHERE starts_with(id, 'social-account:')")).length, 0, 'deleting the client deletes its connected accounts');
}

globalThis.fetch = realFetch;
await pg.close();
console.log(`${checks} connection checks passed: encrypted tokens, signed login round trip, Facebook Page choice with Instagram, publishing with connected accounts, TikTok upload and renewal, YouTube Short, disconnect and client deletion.`);
