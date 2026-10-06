// Security boundaries: horizontal access (one client reaching another's data), vertical access
// (a role reaching an action above it), CSRF on the cookie-authenticated routes, and asset reach.
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';
const esbuildPath = globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0] || 'node_modules/esbuild/lib/main.js';
const esbuild = await import(pathToFileURL(esbuildPath));
const ROOT = process.cwd();
mkdirSync('.sites-runtime', { recursive: true });
for (const [entry, out] of [['app/api/records/route.ts', 'sec-records.mjs'], ['app/api/assets/route.ts', 'sec-assets.mjs'], ['app/api/assets/[id]/route.ts', 'sec-asset-get.mjs']])
  await esbuild.build({ entryPoints: [entry], outfile: `.sites-runtime/${out}`, bundle: true, platform: 'node', format: 'esm', plugins: [testRuntimePlugin({ auth: false })] });
const { db, pg } = await createTestDb();
globalThis.testDb = db;
globalThis.testEnv = { OWNER_EMAIL: 'owner@studio.test' };
const records = await import(pathToFileURL(ROOT + '/.sites-runtime/sec-records.mjs'));
const assets = await import(pathToFileURL(ROOT + '/.sites-runtime/sec-assets.mjs'));
const assetGet = await import(pathToFileURL(ROOT + '/.sites-runtime/sec-asset-get.mjs'));
const ORIGIN = 'https://tracker.test';
const owner = { userId: 'owner', fullName: 'Owner', displayName: 'Owner', email: 'owner@studio.test' };
const as = (u) => { globalThis.testUser = u; };
const WS = 'ws:owner';
let pass = 0, fail = 0;
const check = (label, cond, extra = '') => { if (cond) pass++; else { fail++; console.error('  FAILED:', label, extra); } };
const post = async (body, { ws = WS, origin = ORIGIN, ct = 'application/json' } = {}) => {
  const headers = { 'X-Workspace-Id': ws };
  if (ct) headers['Content-Type'] = ct;
  if (origin) headers.origin = origin;
  const r = await records.POST(new Request(ORIGIN + '/api/records', { method: 'POST', headers, body: JSON.stringify(body) }));
  return { status: r.status, data: await r.json() };
};
const get = async (ws = WS) => { const r = await records.GET(new Request(ORIGIN + '/api/records', { headers: ws ? { 'X-Workspace-Id': ws } : {} })); return { status: r.status, data: await r.json() }; };

as(owner);
const boot = await get(null);
if (boot.status !== 200) { console.error('boot failed', boot); process.exit(1); }
const c1 = (await post({ action: 'create', kind: 'client', data: { name: 'Client Un' } })).data;
const c2 = (await post({ action: 'create', kind: 'client', data: { name: 'Client Deux' } })).data;
const t1 = (await post({ action: 'create', kind: 'task', data: { name: 'Tache Un', clientId: c1.id, status: 'À valider', due: '2027-01-15' } })).data;
const t2 = (await post({ action: 'create', kind: 'task', data: { name: 'Tache Deux', clientId: c2.id, status: 'À valider', due: '2027-01-15' } })).data;
await pg.query("INSERT INTO users (id, name, email, password_hash) VALUES ('cli1','A','a@c.test','x'),('cli2','B','b@c.test','x'),('crea','C','c@s.test','x'),('view','V','v@s.test','x')");
await pg.query("INSERT INTO workspace_members (workspace_id,user_id,role,name,email,client_id) VALUES ($1,'cli1','client','A','a@c.test',$2),($1,'cli2','client','B','b@c.test',$3),($1,'crea','creative','C','c@s.test',NULL),($1,'view','viewer','V','v@s.test',NULL)", [WS, c1.id, c2.id]);
const cli1 = { userId: 'cli1', fullName: 'A', displayName: 'A', email: 'a@c.test' };
const crea = { userId: 'crea', fullName: 'C', displayName: 'C', email: 'c@s.test' };
const view = { userId: 'view', fullName: 'V', displayName: 'V', email: 'v@s.test' };

as(cli1);
const cli1View = await get();
check('client A never receives client B records', !cli1View.data.records.some((r) => r.id === c2.id || r.id === t2.id));
check('client A cannot approve client B task', (await post({ action: 'approve', taskId: t2.id })).status !== 200);
check('client A cannot comment on client B task', (await post({ action: 'comment', taskId: t2.id, text: 'x' })).status !== 200);
check('client A cannot request changes on B task', (await post({ action: 'request-changes', taskId: t2.id, text: 'x' })).status !== 200);
const forged = await post({ action: 'request', clientId: c2.id, data: { name: 'Forged', due: '2027-02-01' } });
check('a client request is forced onto their own client', forged.status === 200 && forged.data.records.find((r) => r.id === forged.data.id)?.clientId === c1.id, JSON.stringify(forged.data).slice(0, 120));
check('client A cannot read B by switching X-Workspace-Id', (await get('ws:someone-else')).status === 403);
check('client A cannot update any record', (await post({ action: 'update', kind: 'task', id: t1.id, revision: 1, data: { name: 'hack', clientId: c1.id } })).status !== 200);
check('client A cannot delete', (await post({ action: 'delete', kind: 'task', id: t1.id, revision: 1 })).status !== 200);
check('client A cannot invite', (await post({ action: 'invite-member', email: 'x@y.test', role: 'admin' })).status !== 200);
check('client A cannot read the member roster', !(cli1View.data.members || []).length);

as(crea);
check('creative cannot create a client', (await post({ action: 'create', kind: 'client', data: { name: 'X' } })).status === 403);
check('creative cannot create a task', (await post({ action: 'create', kind: 'task', data: { name: 'X', clientId: c1.id, due: '2027-02-01' } })).status === 403);
check('creative cannot delete a task', (await post({ action: 'delete', kind: 'task', id: t1.id, revision: 1 })).status === 403);
check('creative cannot invite', (await post({ action: 'invite-member', email: 'x@y.test', role: 'admin' })).status === 403);
check('creative cannot change a role', (await post({ action: 'set-member-role', userId: 'view', expectedRole: 'viewer', role: 'admin' })).status === 403);
check('creative cannot remove a member', (await post({ action: 'remove-member', userId: 'view', expectedRole: 'viewer' })).status === 403);
check('creative cannot create the print workspace', (await post({ action: 'create-print-workspace' })).status === 403);
check('creative cannot notify a client', (await post({ action: 'notify-client', clientId: c1.id })).status === 403);
check('creative never sees documents', !(await get()).data.records.some((r) => r.kind === 'document'));

as(view);
check('viewer cannot comment', (await post({ action: 'comment', taskId: t1.id, text: 'x' })).status === 403);
check('viewer cannot update a task', (await post({ action: 'update', kind: 'task', id: t1.id, revision: 1, data: { name: 'x', clientId: c1.id } })).status === 403);
check('viewer cannot create a platform', (await post({ action: 'create', kind: 'platform', data: { name: 'X' } })).status === 403);
check('viewer cannot upload audio', (await assets.POST(new Request(ORIGIN + '/api/assets', { method: 'POST', headers: { 'X-Workspace-Id': WS, origin: ORIGIN }, body: (() => { const f = new FormData(); f.append('kind', 'audio'); f.append('file', new File([new Uint8Array(10)], 'a.webm', { type: 'audio/webm' })); return f; })() }))).status === 403);

as({ userId: 'nobody', fullName: 'N', displayName: 'N', email: 'nobody@nowhere.test' });
check('a non-member gets no workspace', (await get()).status === 403);
check('a non-member cannot write', (await post({ action: 'create', kind: 'task', data: { name: 'x', clientId: c1.id } })).status === 403);
as(null);
check('anonymous GET is 401', (await get()).status === 401);
check('anonymous POST is 401', (await post({ action: 'create', kind: 'task', data: { name: 'x' } })).status === 401);

as(owner);
check('cross-origin POST refused', (await post({ action: 'create', kind: 'client', data: { name: 'CSRF' } }, { origin: 'https://evil.test' })).status === 403);
const noOrigin = await post({ action: 'create', kind: 'client', data: { name: 'No-Origin' } }, { origin: null });
check('POST with NO Origin header refused', noOrigin.status === 403, `(got ${noOrigin.status})`);
check('non-JSON content type refused', (await post({ action: 'create', kind: 'client', data: { name: 'x' } }, { ct: 'text/plain' })).status === 415);
const assetNoOrigin = await assets.POST(new Request(ORIGIN + '/api/assets', { method: 'POST', headers: { 'X-Workspace-Id': WS }, body: (() => { const f = new FormData(); f.append('kind', 'logo'); f.append('file', new File([new Uint8Array(10)], 'a.png', { type: 'image/png' })); return f; })() }));
check('asset upload with NO Origin refused', assetNoOrigin.status === 403, `(got ${assetNoOrigin.status})`);

as(owner);
const upload = async (kind, user) => { as(user); const f = new FormData(); f.append('kind', kind); f.append('file', new File([new Uint8Array([137, 80, 78, 71])], 'a.png', { type: 'image/png' })); const r = await assets.POST(new Request(ORIGIN + '/api/assets', { method: 'POST', headers: { 'X-Workspace-Id': WS, origin: ORIGIN }, body: f })); return (await r.json()).id; };
const logoId = await upload('logo', owner);
const avatarId = await upload('avatar', cli1);
const fetchAsset = async (id, user) => { as(user); const r = await assetGet.GET(new Request(`${ORIGIN}/api/assets/${id}`), { params: Promise.resolve({ id }) }); return r.status; };
check('a member can read a workspace logo', await fetchAsset(logoId, crea) === 200);
check('an outsider cannot read a workspace logo', await fetchAsset(logoId, { userId: 'nobody', fullName: 'N', displayName: 'N', email: 'n@n.test' }) === 404);
const avatarByOutsider = await fetchAsset(avatarId, { userId: 'nobody', fullName: 'N', displayName: 'N', email: 'n@n.test' });
// Profile pictures are deliberately readable by any signed-in user: a comment author's picture
// has to render for everyone in the thread, whatever workspace they belong to.
check('a profile picture is readable by any signed-in user', avatarByOutsider === 200);
check('anonymous cannot read any asset', await fetchAsset(logoId, null) === 401);

// ---- Post media: only the app's storage or Google Drive — the server downloads these to publish.
{
  as(owner);
  globalThis.testEnv.SUPABASE_URL = 'https://proj.supabase.test';
  const postWith = (url) => post({ action: 'create', kind: 'editorial_post', data: { name: 'Média', clientId: 'internal', due: '2027-01-10', description: 'x', socialState: 'draft', targets: [{ network: 'youtube', format: 'short', title: 't' }], media: [{ url, type: 'video' }] } });
  for (const bad of ['http://169.254.169.254/latest/meta-data/', 'https://169.254.169.254/x.mp4', 'https://evil.example/x.mp4', 'http://drive.google.com/x', 'https://user:pw@drive.google.com/x', 'https://proj.supabase.test/storage/v1/object/public/other-bucket/x.mp4']) {
    const r = await postWith(bad);
    check(`post media refused: ${bad}`, r.status === 400, `got ${r.status}`);
  }
  for (const good of ['https://drive.usercontent.google.com/download?id=VideoFile000000000000001&export=download&confirm=t', 'https://proj.supabase.test/storage/v1/object/public/editorial-media/ws_owner/00000001-0000-0000-0000-000000000000.mp4']) {
    const r = await postWith(good);
    check(`post media accepted: ${good.slice(0, 40)}…`, r.status === 200, `got ${r.status}`);
  }
  await esbuild.build({ entryPoints: ['lib/media-source.ts'], outfile: '.sites-runtime/sec-media-source.mjs', bundle: true, platform: 'node', format: 'esm', plugins: [testRuntimePlugin({ auth: false })] });
  const { fetchMediaSource, isMediaSource } = await import(pathToFileURL(ROOT + '/.sites-runtime/sec-media-source.mjs'));
  // The storage prefix is compared on the parsed address: no dot segments or encoded separators to walk out of the bucket.
  const bucket = 'https://proj.supabase.test/storage/v1/object/public/editorial-media/';
  check('a file in the media bucket is a media source', isMediaSource(bucket + 'ws_owner/00000001-0000-0000-0000-000000000000.mp4'));
  for (const bad of [bucket + '../../../private/secret.mp4', bucket + '..%2f..%2fprivate/secret.mp4', bucket + '%2e%2e/%2e%2e/secret.mp4', bucket + 'ws_owner%2f..%2f..%2fsecret.mp4', bucket + 'ws_owner%5c..%5csecret.mp4', bucket, 'https://proj.supabase.test:8443/storage/v1/object/public/editorial-media/x.mp4'])
    check(`not a media source: ${bad}`, !isMediaSource(bad));
  const realFetch = globalThis.fetch, asked = [];
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    if (String(url).includes('bounce-internal')) return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } });
    if (String(url).includes('bounce-google')) return new Response(null, { status: 302, headers: { location: 'https://doc-0g-00-docs.googleusercontent.com/file.mp4' } });
    return new Response('bytes', { status: 200, headers: { 'content-type': 'video/mp4' } });
  };
  check('download refused for a foreign address', (await fetchMediaSource('https://evil.example/x.mp4')) === null && asked.length === 0, asked.join());
  check('a redirect to an internal address is not followed', (await fetchMediaSource('https://drive.usercontent.google.com/download?id=bounce-internal')) === null && !asked.some((u) => u.includes('169.254')), asked.join());
  check('Drive’s own redirect to Google’s file servers is followed', (await fetchMediaSource('https://drive.usercontent.google.com/download?id=bounce-google'))?.status === 200);
  globalThis.fetch = realFetch;
}

// ---- Security headers (next.config.ts), as production sends them.
{
  process.env.NODE_ENV = 'production';
  await esbuild.build({ entryPoints: ['next.config.ts'], outfile: '.sites-runtime/security-next-config.mjs', bundle: true, platform: 'node', format: 'esm', packages: 'external' });
  const config = (await import(`${pathToFileURL(`${process.cwd()}/.sites-runtime/security-next-config.mjs`).href}?${Date.now()}`)).default;
  const rules = await config.headers();
  const forPath = (path) => Object.fromEntries(rules.filter((r) => new RegExp(`^${r.source.replace(/\/:path\*$/, '(/.*)?')}$`).test(path)).flatMap((r) => r.headers.map((h) => [h.key, h.value])));
  const app = forPath('/');
  const csp = app['Content-Security-Policy'] ?? '';
  check('pages send a Content-Security-Policy', !!csp);
  check('no plugins, no <base> hijack, forms post only here, no framing by other sites', ["object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'"].every((d) => csp.includes(d)));
  check('scripts allow only this site and the Google Picker loader, no eval in production', /script-src 'self' 'unsafe-inline' https:\/\/apis\.google\.com(;|$)/.test(csp) && !csp.includes('unsafe-eval'));
  check('the browser talks only to this site, Daily and the Picker loader', /connect-src 'self' https:\/\/\*\.daily\.co wss:\/\/\*\.daily\.co https:\/\/apis\.google\.com(;|$)/.test(csp));
  check('only meetings and Google Picker can be framed', /frame-src 'self' https:\/\/\*\.daily\.co https:\/\/docs\.google\.com https:\/\/apis\.google\.com(;|$)/.test(csp));
  check('HSTS, nosniff, SAMEORIGIN, referrer policy', !!app['Strict-Transport-Security'] && app['X-Content-Type-Options'] === 'nosniff' && app['X-Frame-Options'] === 'SAMEORIGIN' && !!app['Referrer-Policy']);
  check('camera and microphone stay allowed (meetings, voice messages)', !/camera|microphone|display-capture/.test(app['Permissions-Policy'] ?? ''));
  check('/api routes get the headers too', forPath('/api/records')['X-Content-Type-Options'] === 'nosniff');
  const finance = forPath('/admin/finance/data');
  check('the finance export keeps its own sandbox policy', !finance['Content-Security-Policy'] && finance['X-Frame-Options'] === 'SAMEORIGIN');
  check('no X-Powered-By', config.poweredByHeader === false);
}

await pg.close();
if (fail) { console.error(`${fail} security check(s) FAILED`); process.exit(1); }
console.log(`${pass} security checks passed: horizontal access, vertical access, CSRF, asset reach, post media sources, security headers.`);
