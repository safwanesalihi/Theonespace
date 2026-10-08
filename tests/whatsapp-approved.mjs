// WhatsApp « task approved by the client »: the owner and each admin with a number hear it, only for the
// client's own approval, only when the template is set up, and a Meta failure never costs the approval.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';

const esbuild = await import(pathToFileURL(globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0]));
mkdirSync('.sites-runtime', { recursive: true });
await esbuild.build({ entryPoints: ['app/api/records/route.ts'], outfile: '.sites-runtime/whatsapp-approved.mjs', bundle: true, platform: 'node', format: 'esm', plugins: [testRuntimePlugin({ auth: false })] });
const { db, pg } = await createTestDb();
globalThis.testDb = db;
const env = { OWNER_EMAIL: 'owner@studio.test', AUTH_URL: 'https://space.test', WHATSAPP_TOKEN: 'test-token', WHATSAPP_PHONE_NUMBER_ID: '1234567890', WHATSAPP_TEMPLATE: 'pret_a_valider', WHATSAPP_APPROVED_TEMPLATE: 'tache_validee', WHATSAPP_APPROVED_LANGUAGE: 'fr' };
globalThis.testEnv = env;
const { GET, POST } = await import(pathToFileURL(process.cwd() + '/.sites-runtime/whatsapp-approved.mjs'));
const sent = [];
let reply = { status: 200, body: { messages: [{ id: 'wamid.OK' }] } };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith('https://graph.facebook.com/')) return realFetch(url, init);
  sent.push(JSON.parse(init.body));
  return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } });
};
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const WS = 'ws:owner';
const as = (user) => { globalThis.testUser = user; };
const owner = { userId: 'owner', fullName: 'Studio Owner', displayName: 'Studio Owner', email: 'owner@studio.test' };
async function post(body, status = 200) {
  const r = await POST(new Request('https://space.test/api/records', { method: 'POST', headers: { 'Content-Type': 'application/json', origin: 'https://space.test', 'X-Workspace-Id': WS }, body: JSON.stringify(body) }));
  const d = await r.json(); assert.equal(r.status, status, JSON.stringify(d)); checks++; return d;
}
async function member(id, role, name, clientId = null) {
  await pg.query("INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, 'test-only')", [id, name, `${id}@people.test`]);
  await pg.query('INSERT INTO workspace_members (workspace_id, user_id, role, name, email, client_id) VALUES ($1,$2,$3,$4,$5,$6)', [WS, id, role, name, `${id}@people.test`, clientId]);
  return { userId: id, fullName: name, displayName: name, email: `${id}@people.test` };
}
const runAfter = async () => { for (const callback of (globalThis.testAfter ??= []).splice(0)) await callback(); };

as(owner);
await GET(new Request('https://space.test/api/records'));
const c1 = (await post({ action: 'create', kind: 'client', data: { name: 'Kojo Bakery' } })).id;
const admin = await member('admin', 'admin', 'Adam Admin');
await member('admin2', 'admin', 'Second Admin');
await member('creative', 'creative', 'Crea Designer');
const client = await member('contact', 'client', 'Client Contact', c1);
await post({ action: 'set-member-whatsapp', userId: 'owner', whatsapp: '+212600000001' });
await post({ action: 'set-member-whatsapp', userId: 'admin', whatsapp: '+212600000002' });
await post({ action: 'set-member-whatsapp', userId: 'creative', whatsapp: '+212600000003' });
const waiting = async (name) => {
  as(owner);
  const t = await post({ action: 'create', kind: 'task', data: { name, clientId: c1, status: 'En cours', due: '2027-03-01' } });
  const r = await post({ action: 'update', kind: 'task', id: t.id, revision: 1, data: { name, clientId: c1, due: '2027-03-01', status: 'À valider', deliverable: 'https://drive.test/file' } });
  (globalThis.testAfter ??= []).splice(0); sent.length = 0;
  return r.records.find((x) => x.id === t.id);
};

// The client approves: the owner and the admin with a number hear it — nobody else.
let t = await waiting('Reel ramadan');
as(client);
await post({ action: 'approve', taskId: t.id });
eq(sent.length, 0, 'the approval returns before the WhatsApp requests');
await runAfter();
eq(sent.map((m) => m.to).sort(), ['212600000001', '212600000002'], 'the owner and the admin with a number, not the second admin (no number) nor the creative');
eq(sent.map((m) => m.template.name), ['tache_validee', 'tache_validee'], 'the approved-task template');
eq(sent[0].template.language.code, 'fr', 'in the configured language');
const owners = sent.find((m) => m.to === '212600000001');
eq(owners.template.components[0].parameters.map((p) => p.text), ['Studio Owner', 'Reel ramadan', 'Kojo Bakery', 'https://space.test/login'], 'person, task, client, sign-in address');
as(owner);
const events = (await pg.query("SELECT data FROM records WHERE workspace_id = $1 AND kind = 'event' AND data->>'type' = 'whatsapp' AND data->>'taskId' = $2", [WS, t.id])).rows.map((r) => r.data.name).filter((n) => n.includes('a validé'));
ok(events.length === 2 && events.every((n) => n.startsWith('WhatsApp envoyé') && n.includes('Kojo Bakery a validé')), 'the studio sees both messages went out');

// A studio approval is not the client's: no WhatsApp.
t = await waiting('Affiche pain');
as(admin);
await post({ action: 'approve', taskId: t.id });
await runAfter();
eq(sent.length, 0, 'an approval from the studio sends nothing');

// Without the template, nothing goes out and the approval still works.
t = await waiting('Story soldes');
delete env.WHATSAPP_APPROVED_TEMPLATE;
as(client);
await post({ action: 'approve', taskId: t.id });
await runAfter();
eq(sent.length, 0, 'without WHATSAPP_APPROVED_TEMPLATE nothing is sent');

// Meta failing never costs the approval.
env.WHATSAPP_APPROVED_TEMPLATE = 'tache_validee';
t = await waiting('Carrousel');
reply = { status: 400, body: { error: { message: 'Template paused', code: 132015 } } };
as(client);
await post({ action: 'approve', taskId: t.id });
await runAfter();
const failed = (await pg.query("SELECT data FROM records WHERE workspace_id = $1 AND kind = 'event' AND data->>'type' = 'whatsapp' AND data->>'taskId' = $2", [WS, t.id])).rows.map((r) => r.data.name).filter((n) => n.includes('pour la validation de'));
ok(failed.length === 2 && failed.every((n) => n.startsWith('WhatsApp non envoyé')), 'each failure is logged for the studio, one person’s failure does not stop the next');
const stored = (await pg.query("SELECT data FROM records WHERE id = $1", [t.id])).rows[0].data;
eq(stored.status, 'Validé', 'and the task is approved all the same');
console.log(`${checks} approved-by-client WhatsApp checks passed: owner and admins with a number, template and variables, client approvals only, template off, Meta failure.`);
globalThis.fetch = realFetch;
await pg.close();
