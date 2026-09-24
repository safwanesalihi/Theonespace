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

await pg.close();
if (fail) { console.error(`${fail} security check(s) FAILED`); process.exit(1); }
console.log(`${pass} security checks passed: horizontal access, vertical access, CSRF, asset reach.`);
