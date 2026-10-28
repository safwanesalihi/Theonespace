// A studio's own roles (lib/roles.ts): built from a built-in role, with permissions added or removed.
// An agency's account manager passes « Check AM », its art director « Check DA » and sees every task,
// a project lead creates tasks and sends to the client, a finance administrator sees the money. Nobody
// gets more than their base allows, nor hands out more than they hold.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';

const esbuild = await import(pathToFileURL(globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0]));
mkdirSync('.sites-runtime', { recursive: true });
await esbuild.build({ entryPoints: ['app/api/records/route.ts'], outfile: '.sites-runtime/studio-roles-test.mjs', bundle: true, platform: 'node', format: 'esm', plugins: [testRuntimePlugin({ auth: false })], logLevel: 'error' });
await esbuild.build({ stdin: { contents: "export * from './lib/roles'; export { processSchema, oneCoreProcess } from './lib/process';", resolveDir: process.cwd() }, outfile: '.sites-runtime/studio-roles-lib.mjs', bundle: true, platform: 'node', format: 'esm', logLevel: 'error' });
const lib = await import(pathToFileURL(process.cwd() + '/.sites-runtime/studio-roles-lib.mjs'));

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const set = (s) => [...s].sort();
const issues = (p) => { const r = lib.processSchema.safeParse(p); return r.success ? [] : r.error.issues.map((i) => i.message); };

const roles = [
  { id: 'am', label: 'Account manager', base: 'admin', revoke: ['team'] },
  { id: 'da', label: 'Directeur artistique', base: 'creative', grant: ['review', 'tasks.all'] },
  { id: 'lead', label: 'Chef de projet', base: 'creative', grant: ['tasks.create', 'send'] },
  { id: 'finance', label: 'Finance', base: 'admin', grant: ['money'] },
];

// ----- the rules -----
eq(set(lib.permissionsOf('creative')), [], 'a creative, as always: their own tasks');
eq(set(lib.permissionsOf('creative', roles[1])), ['review', 'tasks.all'], 'an art director reviews and sees every task');
eq(lib.permissionsOf('admin', roles[0]).has('team'), false, 'a permission taken away');
eq(lib.permissionsOf('creative', { id: 'x', label: 'X', base: 'creative', grant: ['team', 'money'] }).has('team'), false, 'never the team or the money on a creative base');
eq(set(lib.permissionsOf('admin', roles[1])), set(lib.basePermissions.admin), 'a role built on another base counts for nothing');
eq(set(lib.permissionsOf('owner', { id: 'y', label: 'Y', base: 'admin', revoke: ['team'] })), set(lib.permissions), 'the owner keeps everything');
ok(issues({ ...lib.oneCoreProcess, roles: [{ id: 'x', label: 'X', base: 'creative', grant: ['money'] }] }).some((m) => m.includes('réservés aux rôles basés sur Administrateur')), 'the rule is explained when saving');
ok(issues({ ...lib.oneCoreProcess, roles: [{ id: 'v', label: 'Lecteur', base: 'viewer', grant: ['send'] }] }).some((m) => m.includes('lecture seule')), 'a read-only role stays read-only');
eq([lib.passesCheck({ role: 'admin' }, ['da']), lib.passesCheck({ role: 'creative', permissions: ['review'], studioRoleId: 'da' }, ['da']), lib.passesCheck({ role: 'owner' }, ['da'])],
  [false, true, true], 'a named check: its role passes it, an administrator without that role doesn’t, the owner always');

// ----- the agency, through the records API -----
const { db, pg } = await createTestDb();
globalThis.testDb = db;
globalThis.testEnv = { OWNER_EMAIL: 'owner@studio.test' };
const owner = { userId: 'owner-a', fullName: 'Owner', displayName: 'Owner', email: 'owner@studio.test' };
const person = (id) => ({ userId: id, fullName: id, displayName: id, email: `${id}@studio.test` });
const as = (u) => { globalThis.testUser = u; };
as(owner);
const { GET, POST } = await import(pathToFileURL(process.cwd() + '/.sites-runtime/studio-roles-test.mjs'));
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
for (const [id, role] of [['sara', 'admin'], ['nadia', 'admin'], ['yasmine', 'creative'], ['karim', 'creative'], ['omar', 'creative']]) {
  await pg.query('INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4)', [id, id, `${id}@studio.test`, 'x']);
  await pg.query('INSERT INTO workspace_members (workspace_id, user_id, role, name, email, created_at) VALUES ($1, $2, $3, $4, $5, now())', [WS, id, role, id, `${id}@studio.test`]);
}
const s = (id, label, behaviour, extra = {}) => ({ id, label, behaviour, color: 'blue', ...extra });
const agency = {
  ...lib.oneCoreProcess,
  statuses: [s('À faire', 'À faire', 'todo'), s('En cours', 'En cours', 'work'), s('am', 'Check AM', 'internal', { reviewers: ['am'] }),
    s('da', 'Check DA', 'internal', { reviewers: ['da'] }), s('À valider', 'À valider', 'client'), s('Validé', 'Validé', 'done')],
  roles,
};
eq(issues(agency), [], 'roles and named checks form a valid process');
ok(issues({ ...agency, statuses: agency.statuses.map((x) => (x.id === 'am' ? { ...x, reviewers: ['ghost'] } : x)) }).some((m) => m.includes('un rôle qui n’existe pas')), 'a check names existing roles only');
await post({ action: 'process-save', data: agency, revision: 0 });
const client = await post({ action: 'create', kind: 'client', data: { name: 'Kojo' } });

// Giving roles: the base must match; an administrator never hands out more than they hold.
await post({ action: 'set-member-studio-role', userId: 'sara', roleId: 'da' }, 400);
await post({ action: 'set-member-studio-role', userId: 'sara', roleId: 'am' });
await post({ action: 'set-member-studio-role', userId: 'yasmine', roleId: 'da' });
await post({ action: 'set-member-studio-role', userId: 'karim', roleId: 'lead' });
await post({ action: 'set-member-studio-role', userId: 'owner-a', roleId: 'am' }, 400);
as(person('nadia'));
await post({ action: 'set-member-studio-role', userId: 'nadia', roleId: 'finance' }, 403);
as(person('sara'));
await post({ action: 'set-member-studio-role', userId: 'omar', roleId: 'lead' }, 403);
as(owner);
await post({ action: 'set-member-studio-role', userId: 'nadia', roleId: 'finance' });
eq((await get()).members.find((m) => m.userId === 'yasmine')?.studioRoleId, 'da', 'the team list shows each studio role');

// The project lead creates tasks; a creative without the permission still can't.
as(person('karim'));
const made = await post({ action: 'create', kind: 'task', data: { name: 'Reel', clientId: client.id, due: '2099-01-10', source: 'Interne', assignee: 'omar' } });
eq((await get()).workspace.permissions.includes('tasks.create'), true, 'the page learns what the person may do');
as(person('omar'));
await post({ action: 'create', kind: 'task', data: { name: 'X', clientId: client.id, due: '2099-01-10', source: 'Interne' } }, 403);

// The art director sees every task; a plain creative only theirs and the unassigned.
await post({ action: 'create', kind: 'task', data: { name: 'Y' } }, 403);
as(owner);
await post({ action: 'create', kind: 'task', data: { name: 'Affiche', clientId: client.id, due: '2099-01-12', source: 'Interne', assignee: 'karim' } });
as(person('yasmine'));
eq((await get()).records.filter((r) => r.kind === 'task').length, 2, 'the art director sees both tasks');
as(person('omar'));
eq((await get()).records.filter((r) => r.kind === 'task').map((t) => t.name), ['Reel'], 'omar sees his own');

// The chain: « Check AM » for the account manager, « Check DA » for the art director.
await pg.query("UPDATE records SET data = jsonb_set(jsonb_set(data, '{status}', '\"am\"'), '{deliverable}', '\"https://drive.test/r\"') WHERE id = $1", [made.id]);
const rev = async () => (await pg.query('SELECT revision FROM records WHERE id = $1', [made.id])).rows[0].revision;
as(person('yasmine'));
await post({ action: 'internal-review', taskId: made.id, revision: await rev(), decision: 'send' }, 403);
as(person('sara'));
let next = await post({ action: 'internal-review', taskId: made.id, revision: await rev(), decision: 'send' });
eq(next.records.find((r) => r.id === made.id).status, 'da', 'the account manager passes « Check AM »');
await post({ action: 'internal-review', taskId: made.id, revision: await rev(), decision: 'send' }, 403);
as(person('yasmine'));
next = await post({ action: 'internal-review', taskId: made.id, revision: await rev(), decision: 'send' });
eq(next.records.find((r) => r.id === made.id).status, 'À valider', 'the art director passes « Check DA »: on to the client');

// The money: the finance administrator reads the quotes, another administrator doesn't know they exist.
await pg.query("INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ('doc1', 'owner-a', $1, 'document', $2::jsonb, 1)",
  [WS, JSON.stringify({ id: 'doc1', kind: 'document', name: 'Devis', docType: 'quote', clientId: client.id, docStatus: 'sent', createdAt: new Date().toISOString() })]);
as(person('nadia'));
ok((await get()).records.some((r) => r.id === 'doc1'), 'finance sees the quote');
as(person('sara'));
ok(!(await get()).records.some((r) => r.id === 'doc1'), 'the account manager doesn’t');

console.log(`studio roles: ${checks} checks passed`);
