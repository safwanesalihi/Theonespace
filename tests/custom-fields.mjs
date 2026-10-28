// A studio's own fields (lib/process.ts FieldDef): an ads agency keeps a budget and an objective on its
// campaigns, a keyword on its articles. Values are checked against their type, a field stays on its work
// types, a member can't change them, and the client sees only the ones the studio shows them.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';

const esbuild = await import(pathToFileURL(globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0]));
mkdirSync('.sites-runtime', { recursive: true });
await esbuild.build({ entryPoints: ['app/api/records/route.ts'], outfile: '.sites-runtime/custom-fields-test.mjs', bundle: true, platform: 'node', format: 'esm', plugins: [testRuntimePlugin({ auth: false })], logLevel: 'error' });
await esbuild.build({ stdin: { contents: "export * from './lib/process'; export { clientTaskCopy } from './lib/flow';", resolveDir: process.cwd() }, outfile: '.sites-runtime/custom-fields-lib.mjs', bundle: true, platform: 'node', format: 'esm', logLevel: 'error' });
const lib = await import(pathToFileURL(process.cwd() + '/.sites-runtime/custom-fields-lib.mjs'));

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const issues = (p) => { const r = lib.processSchema.safeParse(p); return r.success ? [] : r.error.issues.map((i) => i.message); };

const s = (id, label, behaviour) => ({ id, label, behaviour, color: 'blue' });
const agency = {
  ...lib.oneCoreProcess,
  preset: 'ads',
  statuses: [s('brief', 'Brief', 'todo'), s('setup', 'Setup', 'work'), s('client', 'Chez le client', 'client'), s('live', 'En ligne', 'done'), s('writing', 'Rédaction', 'work')],
  workTypes: [
    { id: 'campaign', label: 'Campagne Ads', statusIds: ['brief', 'setup', 'client', 'live'] },
    { id: 'article', label: 'Article SEO', statusIds: ['brief', 'writing', 'client', 'live'] },
  ],
  fields: [
    { id: 'budget', label: 'Budget', type: 'money', unit: 'MAD', workTypes: ['campaign'], client: true },
    { id: 'goal', label: 'Objectif', type: 'choice', options: ['Ventes', 'Leads', 'Notoriété'], workTypes: ['campaign'], client: true },
    { id: 'cpa', label: 'CPA cible', type: 'number', workTypes: ['campaign'] },
    { id: 'keyword', label: 'Mot-clé', type: 'text', workTypes: ['article'], client: true },
    { id: 'owner', label: 'Responsable', type: 'person' },
    { id: 'report', label: 'Rapport', type: 'link' },
    { id: 'launch', label: 'Lancement', type: 'date' },
  ],
};

// ----- the definitions -----
eq(issues(agency), [], 'fields per work type form a valid process');
ok(issues({ ...agency, fields: [{ id: 'g', label: 'Objectif', type: 'choice' }] }).includes('Ajoutez au moins un choix à « Objectif ».'), 'a choice needs options');
ok(issues({ ...agency, fields: [{ id: 'x', label: 'X', type: 'text', workTypes: ['podcast'] }] }).includes('« X » vise un type de travail qui n’existe pas.'), 'only the studio’s work types');
ok(issues({ ...agency, fields: [{ id: 'a', label: 'Budget', type: 'text' }, { id: 'b', label: 'budget', type: 'text' }] }).includes('Deux champs portent le même nom.'), 'names are unique');
eq(lib.readProcess({ ...agency, workTypes: [agency.workTypes[0]] }).fields.find((f) => f.id === 'keyword').workTypes, [], 'a field aimed at a removed work type is kept, for every task');
eq(lib.fieldsFor(agency, { workType: 'article' }).map((f) => f.id), ['keyword', 'owner', 'report', 'launch'], 'an article’s fields: its own and the shared ones');

// ----- the values -----
const team = new Set(['yasmine']);
const check = (values, workType = 'campaign') => lib.checkFieldValues(agency, { workType }, values, team);
eq(check({ budget: '1 500,5'.replace(' ', ''), goal: 'Leads', cpa: 42, owner: 'yasmine', report: 'https://drive.test/r', launch: '2026-11-02', keyword: undefined }),
  { values: { budget: 1500.5, goal: 'Leads', cpa: 42, owner: 'yasmine', report: 'https://drive.test/r', launch: '2026-11-02' } }, 'values in their types; empty ones dropped');
eq(check({ budget: -5 }), { error: 'Valeur invalide pour « Budget ».' }, 'an amount is never negative');
eq(check({ goal: 'Followers' }), { error: 'Valeur invalide pour « Objectif ».' }, 'a choice among its options');
eq(check({ report: 'http://x.test' }), { error: '« Rapport » doit être un lien https://.' });
eq(check({ launch: '2026-13-40' }), { error: 'Valeur invalide pour « Lancement ».' });
eq(check({ owner: 'stranger' }), { error: 'Valeur invalide pour « Responsable ».' }, 'a person from the team');
eq(check({ keyword: 'pain' }), { error: 'Ce champ ne fait pas partie de ce type de travail.' }, 'an article’s field on a campaign is refused');

// ----- what the client sees -----
const task = { id: 't', kind: 'task', revision: 1, name: 'Campagne', workType: 'campaign', status: 'setup', fields: { budget: 1500, cpa: 42, goal: 'Leads', owner: 'yasmine' }, createdAt: '2026-10-01T09:00:00.000Z' };
eq(lib.clientTaskCopy(task, agency).fields, { budget: 1500, goal: 'Leads' }, 'the client reads the fields the studio shows them, never the others');
ok(!('fields' in lib.clientTaskCopy({ ...task, fields: { cpa: 42 } }, agency)), 'no field to show: none at all');

// ----- through the records API -----
const { db, pg } = await createTestDb();
globalThis.testDb = db;
globalThis.testEnv = { OWNER_EMAIL: 'owner@studio.test' };
const owner = { userId: 'owner-a', fullName: 'Owner', displayName: 'Owner', email: 'owner@studio.test' };
globalThis.testUser = owner;
const { GET, POST } = await import(pathToFileURL(process.cwd() + '/.sites-runtime/custom-fields-test.mjs'));
const WS = 'ws:owner-a';
const as = (user) => { globalThis.testUser = user; };
async function post(body, status = 200) {
  const r = await POST(new Request('https://tracker.test/api/records', { method: 'POST', headers: { 'Content-Type': 'application/json', origin: 'https://tracker.test', 'X-Workspace-Id': WS }, body: JSON.stringify(body) }));
  const d = await r.json(); assert.equal(r.status, status, JSON.stringify(d)); checks++; return d;
}
async function get() {
  const r = await GET(new Request('https://tracker.test/api/records', { headers: { 'X-Workspace-Id': WS } }));
  const d = await r.json(); assert.equal(r.status, 200, JSON.stringify(d)); checks++; return d;
}
const day = (offset) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
assert.equal((await GET(new Request('https://tracker.test/api/records'))).status, 200);
const kojo = await post({ action: 'create', kind: 'client', data: { name: 'Kojo Bakery' } });
for (const [id, role, clientId] of [['yasmine', 'creative', null], ['lina', 'client', kojo.id]]) {
  await pg.query('INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4)', [id, id, `${id}@studio.test`, 'x']);
  await pg.query('INSERT INTO workspace_members (workspace_id, user_id, role, name, email, client_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, now())', [WS, id, role, id, `${id}@studio.test`, clientId]);
}
await post({ action: 'process-save', data: agency, revision: 0 });

const base = { clientId: kojo.id, due: day(30), source: 'Interne', workType: 'campaign', assignee: 'yasmine' };
let made = await post({ action: 'create', kind: 'task', data: { ...base, name: 'Ramadan', fields: { budget: '2500', goal: 'Ventes', cpa: '30', owner: 'yasmine' } } });
let row = made.records.find((r) => r.id === made.id);
eq(row.fields, { budget: 2500, goal: 'Ventes', cpa: 30, owner: 'yasmine' }, 'saved in their types');
await post({ action: 'create', kind: 'task', data: { ...base, name: 'X', fields: { goal: 'Followers' } } }, 400);
await post({ action: 'create', kind: 'client', data: { name: 'Y', fields: { budget: 1 } } }, 400);

// Saving without the fields keeps them; a member changes the status, never a field.
let next = await post({ action: 'update', kind: 'task', id: row.id, revision: row.revision, data: { ...base, name: 'Ramadan', status: 'setup' } });
row = next.records.find((r) => r.id === row.id);
eq(row.fields.budget, 2500, 'a save that doesn’t mention the fields keeps them');
as({ userId: 'yasmine', fullName: 'yasmine', displayName: 'yasmine', email: 'yasmine@studio.test' });
next = await post({ action: 'update', kind: 'task', id: row.id, revision: row.revision, data: { ...base, name: 'Ramadan', status: 'brief', fields: { ...row.fields } } });
row = next.records.find((r) => r.id === row.id);
eq(row.status, 'brief', 'a member sending the fields unchanged still moves the status');
await post({ action: 'update', kind: 'task', id: row.id, revision: row.revision, data: { ...base, name: 'Ramadan', status: 'brief', fields: { ...row.fields, budget: 99999 } } }, 403);

// The client reads only what the studio shows them.
as({ userId: 'lina', fullName: 'lina', displayName: 'lina', email: 'lina@studio.test' });
const portal = await get();
eq(portal.records.find((r) => r.id === row.id)?.fields, { budget: 2500, goal: 'Ventes' }, 'the portal receives the client-visible fields only');

console.log(`custom fields: ${checks} checks passed`);
