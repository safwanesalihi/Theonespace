import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';

const esbuild = await import(pathToFileURL(globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0]));
mkdirSync('.sites-runtime', { recursive: true });
await esbuild.build({ entryPoints: ['app/api/records/route.ts', 'lib/task-sort.ts', 'lib/client-pipeline.ts'], outdir: '.sites-runtime/task-alerts-test', bundle: true, platform: 'node', format: 'esm', plugins: [testRuntimePlugin({ auth: false })] });
const { db, pg } = await createTestDb();
const owner = { userId: 'alerts-owner', fullName: 'Owner', displayName: 'Owner', email: 'owner@studio.test' };
const ws = 'ws:alerts-owner', origin = 'https://space.test';
const env = { OWNER_EMAIL: owner.email, AUTH_URL: origin, WHATSAPP_TOKEN: 'test-only', WHATSAPP_PHONE_NUMBER_ID: '1234567890', WHATSAPP_CHANGES_TEMPLATE: 'retours_client', WHATSAPP_CHANGES_LANGUAGE: 'fr', WHATSAPP_REMINDER_TEMPLATE: 'rappel_tache', WHATSAPP_REMINDER_LANGUAGE: 'fr' };
globalThis.testDb = db; globalThis.testEnv = env; globalThis.testUser = owner; globalThis.testAfter = [];
const { GET, POST } = await import(pathToFileURL(`${process.cwd()}/.sites-runtime/task-alerts-test/app/api/records/route.js`));
const { compareTasks } = await import(pathToFileURL(`${process.cwd()}/.sites-runtime/task-alerts-test/lib/task-sort.js`));
const { emptyServiceScope } = await import(pathToFileURL(`${process.cwd()}/.sites-runtime/task-alerts-test/lib/client-pipeline.js`));
let checks = 0;
const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
const ok = (value, label) => { assert.ok(value, label); checks++; };
const calls = [];
let meta = { status: 200, body: { messages: [{ id: 'wamid.ALERT' }] } };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith('https://graph.facebook.com/')) return realFetch(url, init);
  calls.push(JSON.parse(init.body));
  return new Response(JSON.stringify(meta.body), { status: meta.status, headers: { 'Content-Type': 'application/json' } });
};
async function request(body) { const res = await POST(new Request(`${origin}/api/records`, { method: 'POST', headers: { 'Content-Type': 'application/json', origin, 'X-Workspace-Id': ws }, body: JSON.stringify(body) })); return { status: res.status, data: await res.json() }; }
async function post(body, status = 200) { const reply = await request(body); eq(reply.status, status, JSON.stringify(reply.data)); return reply.data; }
const flush = async () => { for (const callback of globalThis.testAfter.splice(0)) await callback(); };
const read = async id => (await db.query('SELECT data, revision FROM records WHERE id = $1', [id]))[0];
const events = async id => (await db.query("SELECT data FROM records WHERE workspace_id = $1 AND kind = 'event' AND data->>'taskId' = $2 AND data->>'type' = 'whatsapp'", [ws, id])).map(r => r.data);
await GET(new Request(`${origin}/api/records`));
const clientRecord = await post({ action: 'create', kind: 'client', data: { name: 'Client QA' } });
const users = {};
for (const [role, name] of [['client', 'Client'], ['creative', 'Salma'], ['admin', 'Admin'], ['social', 'Social']]) {
  const email = `${role}@alerts.test`;
  const invitation = await post({ action: 'invite-member', role, name, email, ...(role === 'client' ? { clientId: clientRecord.id } : {}) });
  users[role] = { userId: invitation.members.find(m => m.email === email).userId, email, fullName: name, displayName: name };
}
users.viewer = { userId: 'legacy-viewer', fullName: 'Viewer', displayName: 'Viewer', email: 'viewer@alerts.test' };
await db.query('INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4)', [users.viewer.userId, 'Viewer', users.viewer.email, 'test-only']);
await db.query('INSERT INTO workspace_members (workspace_id, user_id, role, name, email) VALUES ($1, $2, $3, $4, $5)', [ws, users.viewer.userId, 'viewer', 'Viewer', users.viewer.email]);
await post({ action: 'set-member-whatsapp', userId: users.creative.userId, whatsapp: '06 11 22 33 44' });
const seed = async (id, extra = {}) => {
  const record = { id, kind: 'task', revision: 1, name: 'Poster QA', clientId: clientRecord.id, assigneeId: users.creative.userId, assignee: 'Salma', status: 'À valider', due: '2099-03-01', createdAt: new Date().toISOString(), approvalDueAt: new Date(Date.now() + 86400000).toISOString(), ...extra };
  await db.query('INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ($1, $2, $3, $4, $5::jsonb, 1)', [id, owner.email, ws, record.kind, JSON.stringify(record)]);
  return record;
};

// Feedback saves atomically and responds before Meta is contacted; only the assigned member receives it.
await seed('changes'); globalThis.testUser = users.client;
const changed = await post({ action: 'request-changes', taskId: 'changes', text: 'Changer le titre.' });
eq(calls.length, 0, 'Meta never blocks the client response');
eq(changed.records.find(r => r.id === 'changes').status, 'En cours');
ok(changed.records.some(r => r.kind === 'comment' && r.taskId === 'changes' && r.name.includes('Changer le titre.')), 'feedback is a chat message');
ok(!JSON.stringify(changed).includes('611223344'), 'member contact is not exposed to the client');
eq(globalThis.testAfter.length, 1); await flush();
eq(calls.length, 1); eq(calls[0].to, '212611223344');
eq(calls[0].template.name, 'retours_client'); eq(calls[0].template.language.code, 'fr');
eq(calls[0].template.components[0].parameters.map(p => p.text), ['Salma', 'Poster QA', 'Client QA', `${origin}/login`]);
ok((await events('changes')).some(e => e.whatsappMessageId === 'wamid.ALERT' && e.audience === 'studio'));
await post({ action: 'request-changes', taskId: 'changes', text: 'Retry.' }, 409); await flush(); eq(calls.length, 1, 'repeated feedback cannot send twice');

await seed('concurrent');
const simultaneous = await Promise.all([request({ action: 'request-changes', taskId: 'concurrent', text: 'A' }), request({ action: 'request-changes', taskId: 'concurrent', text: 'B' })]);
eq(simultaneous.map(r => r.status).sort(), [200, 409]);
eq(globalThis.testAfter.length, 1, 'only the committed decision queues a notification'); await flush();

// Failed contact/template/Meta delivery never rolls back the client decision.
delete env.WHATSAPP_CHANGES_TEMPLATE; await seed('unconfigured');
await post({ action: 'request-changes', taskId: 'unconfigured', text: 'Retouche' }); const beforeMissing = calls.length; await flush();
eq(calls.length, beforeMissing); eq((await read('unconfigured')).data.status, 'En cours');
ok((await events('unconfigured')).some(e => e.name.includes('WHATSAPP_CHANGES_TEMPLATE')));
env.WHATSAPP_CHANGES_TEMPLATE = 'retours_client';
meta = { status: 400, body: { error: { code: 131042, message: 'Payment issue' } } };
await seed('meta-failure'); await post({ action: 'request-changes', taskId: 'meta-failure', text: 'Retouche' }); await flush();
eq((await read('meta-failure')).data.revisionRound, 1); ok((await events('meta-failure')).some(e => e.name.includes('Payment issue')));
meta = { status: 200, body: { messages: [{ id: 'wamid.ALERT' }] } };
await seed('unassigned', { assigneeId: null, assignee: '' });
await post({ action: 'request-changes', taskId: 'unassigned', text: 'Retouche' }); const beforeUnassigned = calls.length; await flush();
eq(calls.length, beforeUnassigned); ok((await events('unassigned')).some(e => /assigné actif/.test(e.name)));

// A failing comment insert rolls back the status/round and does not queue an alert.
await seed('rollback');
globalThis.testDb = { ...db, transaction: fn => db.transaction(tx => fn({ ...tx, async query(sql, params = []) { if (sql.startsWith('INSERT INTO records') && params.includes('comment')) throw new Error('simulated comment failure'); return tx.query(sql, params); } })) };
await post({ action: 'request-changes', taskId: 'rollback', text: 'Retouche' }, 503);
globalThis.testDb = db;
eq((await read('rollback')).data.status, 'À valider'); eq((await read('rollback')).revision, 1); eq(globalThis.testAfter.length, 0);

// Studio-recorded client feedback also alerts the assignee.
globalThis.testUser = owner; await seed('studio-feedback');
await post({ action: 'request-changes', taskId: 'studio-feedback', text: 'Retours reçus en réunion' }); await flush();
eq(calls.at(-1).template.components[0].parameters[2].text, 'Client QA');

// Outside the contracted revision allowance, notify without starting production.
await seed('contract', { kind: 'document', docType: 'contract', docStatus: 'accepted', serviceScope: emptyServiceScope(), issuedAt: '2020-01-01', workflowTerms: { maxRevisionRounds: 2 } });
await seed('extra-round', { revisionRound: 2 }); globalThis.testUser = users.client;
const extra = await post({ action: 'request-changes', taskId: 'extra-round', text: 'Encore un tour' });
ok(extra.extraRequestId); eq((await read('extra-round')).data.status, 'En pause'); await flush();
eq(calls.at(-1).template.name, 'retours_client'); eq((await read('extra-round')).data.status, 'En pause');

// Reminders: manager-only, current revision, unfinished task, atomic one-minute limit.
await seed('reminder', { status: 'À faire', approvalDueAt: undefined });
for (const role of ['client', 'creative', 'social', 'viewer']) { globalThis.testUser = users[role]; await post({ action: 'remind-assignee-whatsapp', taskId: 'reminder', revision: 1 }, 403); }
globalThis.testUser = users.admin;
await post({ action: 'remind-assignee-whatsapp', taskId: 'reminder', revision: 0 }, 409);
const beforeRemind = calls.length;
const concurrentReminders = await Promise.all([request({ action: 'remind-assignee-whatsapp', taskId: 'reminder', revision: 1 }), request({ action: 'remind-assignee-whatsapp', taskId: 'reminder', revision: 1 })]);
eq(concurrentReminders.map(r => r.status).sort(), [200, 429]); eq(calls.length, beforeRemind + 1);
eq(calls.at(-1).template.name, 'rappel_tache'); eq(calls.at(-1).to, '212611223344');
eq(calls.at(-1).template.components[0].parameters.map(p => p.text), ['Salma', 'Poster QA', 'Admin', `${origin}/login`]);
eq((await read('reminder')).revision, 1); eq((await read('reminder')).data.status, 'À faire');
await post({ action: 'remind-assignee-whatsapp', taskId: 'reminder', revision: 1 }, 429);
await db.query("UPDATE records SET data = jsonb_build_object('retryAfter', now() - interval '1 second') WHERE id = $1", ['whatsapp-assignee-reminder:reminder']);
globalThis.testUser = owner;
eq((await post({ action: 'remind-assignee-whatsapp', taskId: 'reminder', revision: 1 })).whatsapp.sent, true);
await seed('completed', { status: 'Validé' }); await post({ action: 'remind-assignee-whatsapp', taskId: 'completed', revision: 1 }, 409);
await seed('published', { publishedAt: new Date().toISOString() }); await post({ action: 'remind-assignee-whatsapp', taskId: 'published', revision: 1 }, 409);
await seed('archived', { archived: true }); await post({ action: 'remind-assignee-whatsapp', taskId: 'archived', revision: 1 }, 404);
await post({ action: 'remind-assignee-whatsapp', taskId: 'unassigned', revision: 2 }, 409);
await post({ action: 'remind-assignee-whatsapp', taskId: 'foreign-id', revision: 1 }, 404);
await post({ action: 'set-member-whatsapp', userId: users.creative.userId, whatsapp: '' });
await seed('no-number'); const noNumberCalls = calls.length;
const noNumber = await post({ action: 'remind-assignee-whatsapp', taskId: 'no-number', revision: 1 });
eq(noNumber.whatsapp.sent, false); ok(noNumber.whatsapp.error.includes('Équipe')); eq(calls.length, noNumberCalls);
await post({ action: 'set-member-whatsapp', userId: users.creative.userId, whatsapp: '0611223344' });
delete env.WHATSAPP_REMINDER_TEMPLATE; await seed('no-reminder-template');
const noTemplate = await post({ action: 'remind-assignee-whatsapp', taskId: 'no-reminder-template', revision: 1 });
eq(noTemplate.whatsapp.sent, false); ok(noTemplate.whatsapp.error.includes('WHATSAPP_REMINDER_TEMPLATE'));

const sortTasks = [
  { id: 'approved', name: 'A', status: 'Validé', due: '2020-01-01' },
  { id: 'review', name: 'A', status: 'À valider', due: '2020-01-01' },
  { id: 'late', name: 'A', status: 'À faire', due: '2099-01-01' },
  { id: 'paused', name: 'A', status: 'En pause', due: '2020-01-01' },
  { id: 'doing', name: 'A', status: 'En cours', due: '2020-01-01' },
  { id: 'early', name: 'A', status: 'À faire', due: '2027-01-01' },
  { id: 'no-date', name: 'Z', status: 'À faire' },
];
eq(sortTasks.slice().sort(compareTasks).map(t => t.id), ['early', 'late', 'no-date', 'doing', 'paused', 'review', 'approved'], 'default workflow order before due date');
eq(sortTasks.slice().reverse().sort(compareTasks).map(t => t.id), sortTasks.slice().sort(compareTasks).map(t => t.id), 'stable order across API refreshes');
eq(sortTasks.slice().sort((a, b) => compareTasks(a, b, 'due'))[0].due, '2020-01-01', 'date override still works');
eq([{ id: 'b', name: 'B' }, { id: 'a', name: 'A' }].sort((a, b) => compareTasks(a, b, 'name')).map(t => t.id), ['a', 'b']);

globalThis.fetch = realFetch; await pg.close();
console.log(`Task assignee alerts and ordering: ${checks} checks passed`);
