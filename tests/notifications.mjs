// A studio chooses which messages the app sends on its own (lib/process.ts notifications): every one is on
// by default, as before; switched off, nothing reaches Meta or Gmail for it, while in-app notices and the
// sends a person clicks on purpose (reminding an assignee) stay.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';

const esbuild = await import(pathToFileURL(globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0]));
mkdirSync('.sites-runtime', { recursive: true });
await esbuild.build({ entryPoints: ['app/api/records/route.ts'], outfile: '.sites-runtime/notifications-test.mjs', bundle: true, platform: 'node', format: 'esm', external: ['nodemailer'], plugins: [testRuntimePlugin({ auth: false })], logLevel: 'error' });
await esbuild.build({ stdin: { contents: "export * from './lib/process';", resolveDir: process.cwd() }, outfile: '.sites-runtime/notifications-lib.mjs', bundle: true, platform: 'node', format: 'esm', logLevel: 'error' });
const lib = await import(pathToFileURL(process.cwd() + '/.sites-runtime/notifications-lib.mjs'));

let checks = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const issues = (p) => { const r = lib.processSchema.safeParse(p); return r.success ? [] : r.error.issues.map((i) => i.message); };

// ----- the switches -----
eq(lib.notifyEvents.every((e) => lib.notifyRoutes[e].every((c) => lib.notifies(lib.oneCoreProcess, e, c))), true, 'everything is on by default');
const quiet = { ...lib.oneCoreProcess, notifications: { assigned: { whatsapp: false }, approved: { email: false } } };
eq(issues(quiet), [], 'switches are a valid process');
eq([lib.notifies(quiet, 'assigned', 'whatsapp'), lib.notifies(quiet, 'approved', 'whatsapp'), lib.notifies(quiet, 'approved', 'email')], [false, true, false], 'each message and channel on its own');
eq(issues({ ...lib.oneCoreProcess, notifications: { party: { whatsapp: false } } }).length > 0, true, 'only the app’s own messages');

// ----- through the API, with Meta mocked -----
const { db } = await createTestDb();
const owner = { userId: 'notif-owner', fullName: 'Owner', displayName: 'Owner', email: 'owner@studio.test' };
const ws = 'ws:notif-owner', origin = 'https://space.test';
globalThis.testDb = db;
globalThis.testEnv = { OWNER_EMAIL: owner.email, AUTH_URL: origin, WHATSAPP_TOKEN: 'test-only', WHATSAPP_PHONE_NUMBER_ID: '1234567890', WHATSAPP_TEMPLATE: 'pret_a_valider',
  WHATSAPP_ASSIGNMENT_TEMPLATE: 'tache_assignee', WHATSAPP_CHANGES_TEMPLATE: 'retours_client', WHATSAPP_REMINDER_TEMPLATE: 'rappel_tache', WHATSAPP_TEMPLATE_LANGUAGE: 'fr' };
globalThis.testUser = owner; globalThis.testAfter = [];
const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith('https://graph.facebook.com/')) return realFetch(url, init);
  calls.push(JSON.parse(init.body).template.name);
  return new Response(JSON.stringify({ messages: [{ id: 'wamid.N' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const { GET, POST } = await import(pathToFileURL(process.cwd() + '/.sites-runtime/notifications-test.mjs'));
async function post(body, status = 200) {
  const r = await POST(new Request(`${origin}/api/records`, { method: 'POST', headers: { 'Content-Type': 'application/json', origin, 'X-Workspace-Id': ws }, body: JSON.stringify(body) }));
  const d = await r.json(); assert.equal(r.status, status, JSON.stringify(d)); checks++; return d;
}
const flush = async () => { for (const callback of globalThis.testAfter.splice(0)) await callback(); };
await GET(new Request(`${origin}/api/records`));
const client = await post({ action: 'create', kind: 'client', data: { name: 'Kojo', whatsapp: '0612345678' } });
const invited = await post({ action: 'invite-member', role: 'creative', name: 'Salma', email: 'salma@studio.test' });
const salma = invited.members.find((m) => m.email === 'salma@studio.test');
await post({ action: 'set-member-whatsapp', userId: salma.userId, whatsapp: '06 11 22 33 44' });
const due = '2099-03-01';

// On by default: assigning Salma sends her the assignment template.
let made = await post({ action: 'create', kind: 'task', data: { name: 'Reel', clientId: client.id, due, source: 'Interne', assignee: 'Salma' } });
await flush();
eq(calls.splice(0), ['tache_assignee'], 'assigned: sent by default');

// Switched off: no assignment message, no changes alert; the task still saves.
await post({ action: 'process-save', data: { ...lib.oneCoreProcess, notifications: { assigned: { whatsapp: false }, changes: { whatsapp: false } } }, revision: 0 });
made = await post({ action: 'create', kind: 'task', data: { name: 'Post', clientId: client.id, due, source: 'Interne', assignee: 'Salma' } });
await flush();
eq(calls.splice(0), [], 'assigned: off, nothing reaches Meta');
const task = made.records.find((r) => r.id === made.id);
eq(task.assignee, 'Salma', 'the assignment itself is saved');
await db.query("UPDATE records SET data = jsonb_set(jsonb_set(jsonb_set(data, '{status}', '\"À valider\"'), '{deliverable}', '\"https://drive.test/p\"'), '{approvalDueAt}', to_jsonb($2::text)) WHERE id = $1", [task.id, new Date(Date.now() + 86_400_000).toISOString()]);
await post({ action: 'request-changes', taskId: task.id, text: 'Plus de lumière.' });
await flush();
eq(calls.splice(0), [], 'changes: off, the assignee is not messaged');

// A reminder is a click: always sent, whatever the switches.
const fresh = (await db.query('SELECT revision FROM records WHERE id = $1', [task.id]))[0];
await post({ action: 'remind-assignee-whatsapp', taskId: task.id, revision: fresh.revision });
eq(calls.splice(0), ['rappel_tache'], 'a reminder clicked on purpose goes out');

console.log(`notifications: ${checks} checks passed`);
