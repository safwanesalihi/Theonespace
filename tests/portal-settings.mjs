// A studio shapes its clients' portal (lib/process.ts PortalSettings): the pages offered, its own word for
// each step, a welcome message. The client receives these settings with the calendar numbers, never the
// studio's process; a page switched off is refused on the server too (requests).
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';

const esbuild = await import(pathToFileURL(globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0]));
mkdirSync('.sites-runtime', { recursive: true });
await esbuild.build({ entryPoints: ['app/api/records/route.ts'], outfile: '.sites-runtime/portal-settings-test.mjs', bundle: true, platform: 'node', format: 'esm', plugins: [testRuntimePlugin({ auth: false })], logLevel: 'error' });
await esbuild.build({ stdin: { contents: "export * from './lib/process';", resolveDir: process.cwd() }, outfile: '.sites-runtime/portal-settings-lib.mjs', bundle: true, platform: 'node', format: 'esm', logLevel: 'error' });
const lib = await import(pathToFileURL(process.cwd() + '/.sites-runtime/portal-settings-lib.mjs'));

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const issues = (p) => { const r = lib.processSchema.safeParse(p); return r.success ? [] : r.error.issues.map((i) => i.message); };

const portal = { sections: { documents: false, request: false }, words: { client: 'À relire', done: 'Prêt' }, welcome: 'Bienvenue chez Atlas : tout votre contenu, au même endroit.' };
const studio = { ...lib.oneCoreProcess, portal };

// ----- the rules -----
eq(issues(studio), [], 'portal settings form a valid process');
ok(issues({ ...lib.oneCoreProcess, portal: { words: { client: 'x'.repeat(31) } } }).includes('Trente caractères au plus pour un mot du portail.'), 'words stay short');
ok(issues({ ...lib.oneCoreProcess, portal: { welcome: 'x'.repeat(281) } }).includes('Le message d’accueil fait 280 caractères au plus.'));
ok(issues({ ...lib.oneCoreProcess, portal: { sections: { home: false } } }).length > 0, 'home and « à valider » can’t be switched off');
eq([lib.portalShows(studio, 'documents'), lib.portalShows(studio, 'calendar'), lib.portalShows(lib.oneCoreProcess, 'request')], [false, true, true], 'every page unless switched off');

// ----- through the records API -----
const { db, pg } = await createTestDb();
globalThis.testDb = db;
globalThis.testEnv = { OWNER_EMAIL: 'owner@studio.test' };
const owner = { userId: 'owner-a', fullName: 'Owner', displayName: 'Owner', email: 'owner@studio.test' };
const lina = { userId: 'lina', fullName: 'Lina', displayName: 'Lina', email: 'lina@client.test' };
const as = (u) => { globalThis.testUser = u; };
as(owner);
const { GET, POST } = await import(pathToFileURL(process.cwd() + '/.sites-runtime/portal-settings-test.mjs'));
const WS = 'ws:owner-a';
async function post(body, status = 200) {
  const r = await POST(new Request('https://tracker.test/api/records', { method: 'POST', headers: { 'Content-Type': 'application/json', origin: 'https://tracker.test', 'X-Workspace-Id': WS }, body: JSON.stringify(body) }));
  const d = await r.json(); assert.equal(r.status, status, JSON.stringify(d)); checks++; return d;
}
async function get() {
  const r = await GET(new Request('https://tracker.test/api/records', { headers: { 'X-Workspace-Id': WS } }));
  const d = await r.json(); assert.equal(r.status, 200, JSON.stringify(d)); checks++; return d;
}
assert.equal((await GET(new Request('https://tracker.test/api/records'))).status, 200);
const client = await post({ action: 'create', kind: 'client', data: { name: 'Kojo' } });
await pg.query('INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4)', ['lina', 'Lina', 'lina@client.test', 'x']);
await pg.query("INSERT INTO workspace_members (workspace_id, user_id, role, name, email, client_id, created_at) VALUES ($1, 'lina', 'client', 'Lina', 'lina@client.test', $2, now())", [WS, client.id]);

// Before any settings: the usual portal, and requests work.
as(lina);
let page = await get();
eq(page.portal, {}, 'no settings: the usual portal');
await post({ action: 'request', data: { name: 'Un reel pour la fête', description: 'Pour le 20.' } });

as(owner);
await post({ action: 'process-save', data: studio, revision: 0 });

as(lina);
page = await get();
eq(page.portal, portal, 'the client receives the studio’s portal settings');
ok(!('process' in page), 'never the studio’s process');
eq(page.rules.lockDays, 7, 'with the calendar numbers');
await post({ action: 'request', data: { name: 'Encore un reel', description: 'Pour le 25.' } }, 403);

// The studio can still record a request for its client (from a phone call, WhatsApp…).
as(owner);
await post({ action: 'request', clientId: client.id, data: { name: 'Affiche', description: 'Demandée au téléphone.' } });

console.log(`portal settings: ${checks} checks passed`);
