// « Exporter les données » (lib/workspace-export.ts, /api/workspace-export): the owner downloads everything the
// agency made — its records, process, settings, team and the list of its files — and never what only makes
// the platform run: social and Drive login tokens, password hashes, sign-up codes. Nobody else may export.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';

const esbuild = await import(pathToFileURL(globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0]));
mkdirSync('.sites-runtime', { recursive: true });
await esbuild.build({ entryPoints: { records: 'app/api/records/route.ts', exported: 'app/api/workspace-export/route.ts' }, outdir: '.sites-runtime/workspace-export', bundle: true, platform: 'node', format: 'esm', plugins: [testRuntimePlugin({ auth: false })], logLevel: 'error' });

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const { db, pg } = await createTestDb();
globalThis.testDb = db;
globalThis.testEnv = { OWNER_EMAIL: 'owner@nova.test' };
const owner = { userId: 'owner-a', fullName: 'Nadia', displayName: 'Nadia', email: 'owner@nova.test' };
const as = (u) => { globalThis.testUser = { mustChangePassword: false, ...u }; };
as(owner);
const records = await import(pathToFileURL(`${process.cwd()}/.sites-runtime/workspace-export/records.js`));
const exporter = await import(pathToFileURL(`${process.cwd()}/.sites-runtime/workspace-export/exported.js`));
const WS = 'ws:owner-a';
const post = async (body) => {
  const r = await records.POST(new Request('https://space.test/api/records', { method: 'POST', headers: { 'Content-Type': 'application/json', origin: 'https://space.test', 'X-Workspace-Id': WS }, body: JSON.stringify(body) }));
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  return r.json();
};
const download = (workspace = WS) => exporter.GET(new Request('https://space.test/api/workspace-export', { headers: workspace ? { 'X-Workspace-Id': workspace } : {} }));

await records.GET(new Request('https://space.test/api/records'));
const clientId = (await post({ action: 'create', kind: 'client', data: { name: 'Atelier Atlas' } })).id;
await post({ action: 'create', kind: 'task', data: { name: 'Reel lancement', clientId, due: '2099-01-10', source: 'Interne' } });
await post({ action: 'process-save', data: { ...(await (await records.GET(new Request('https://space.test/api/records', { headers: { 'X-Workspace-Id': WS } }))).json()).process, portal: { welcome: 'Bienvenue.' } }, revision: 0 });
// What only makes the platform run: a client's connected Facebook (token), the agency's Drive, a sign-up code.
const meta = (id, data) => pg.query("INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ($1, 'owner-a', $2, 'meta', $3::jsonb, 1)", [id, WS, JSON.stringify(data)]);
await meta(`social-account:${clientId}:meta`, { accessToken: 'enc:SECRET-FB-TOKEN', page: 'Atlas' });
await meta(`google-drive:${WS}`, { refreshToken: 'enc:SECRET-DRIVE-TOKEN' });
await meta('whatsapp-retry:x', { to: '+212600000000' });
await pg.query("INSERT INTO users (id, name, email, password_hash) VALUES ('sara', 'Sara', 'sara@nova.test', 'HASH-SECRET')");
await pg.query("INSERT INTO workspace_members (workspace_id, user_id, role, name, email, created_at) VALUES ($1, 'sara', 'admin', 'Sara', 'sara@nova.test', now())", [WS]);

// The owner downloads it.
const res = await download();
eq(res.status, 200, 'the owner exports');
ok(/attachment; filename="the-one-space-.+-\d{4}-\d{2}-\d{2}\.json"/.test(res.headers.get('Content-Disposition') ?? ''), 'as a dated file to save');
const text = await res.text();
const data = JSON.parse(text);
eq([data.format, data.version], ['the-one-space-export', 1], 'a versioned format');
ok(data.records.some((r) => r.kind === 'client' && r.data.name === 'Atelier Atlas'), 'its clients');
ok(data.records.some((r) => r.kind === 'task' && r.data.name === 'Reel lancement'), 'its tasks');
ok(data.records.some((r) => r.id === `process:${WS}` && r.data.portal?.welcome === 'Bienvenue.'), 'its process and settings');
eq(data.team.map((m) => m.email).sort(), ['owner@nova.test', 'sara@nova.test'], 'its team');
eq(data.counts.task, 1, 'counted by kind');
ok(Array.isArray(data.files), 'the list of its uploaded files');

// Never a secret.
for (const secret of ['SECRET-FB-TOKEN', 'SECRET-DRIVE-TOKEN', 'HASH-SECRET', 'password_hash', 'whatsapp-retry']) ok(!text.includes(secret), `no « ${secret} » in the file`);

// Nobody else.
as({ userId: 'sara', fullName: 'Sara', displayName: 'Sara', email: 'sara@nova.test' });
eq((await download()).status, 403, 'an administrator can’t export');
as({ userId: 'stranger', fullName: 'X', displayName: 'X', email: 'x@else.test' });
eq((await download()).status, 403, 'a stranger can’t either');
as(owner);
eq((await download(null)).status, 400, 'a workspace must be named');
globalThis.testUser = null;
eq((await download()).status, 401, 'signed out: nothing');

console.log(`workspace export: ${checks} checks passed`);
