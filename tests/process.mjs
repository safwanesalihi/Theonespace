// A studio's own process (lib/process.ts): the rules a process must keep, the ready-made ones, and a full
// run on the video production model through the records API — the owner saves it, tasks start in its
// first status, the internal check, the client's approval landing on « Livré », changes back to the
// first production step, the clock only in production, a removed status asking where its tasks go,
// pages turned off, and nobody but the owner changing any of it.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';

const esbuild = await import(pathToFileURL(globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0] || 'node_modules/esbuild/lib/main.js'));
mkdirSync('.sites-runtime', { recursive: true });
await esbuild.build({ entryPoints: ['app/api/records/route.ts'], outfile: '.sites-runtime/process-test.mjs', bundle: true, platform: 'node', format: 'esm', plugins: [testRuntimePlugin({ auth: false })], logLevel: 'error' });
await esbuild.build({ stdin: { contents: "export * from './lib/process'; export * from './lib/process-presets'; export { approve, clientTaskCopy, courtOf, requestChanges, sendForValidation, submitForReview, sweep, computeMetrics, monthPeriod } from './lib/flow'; export { compareTasks, taskStatusOrder } from './lib/task-sort';", resolveDir: process.cwd() }, outfile: '.sites-runtime/process-rules.mjs', bundle: true, platform: 'node', format: 'esm', logLevel: 'error' });
const rules = await import(pathToFileURL(process.cwd() + '/.sites-runtime/process-rules.mjs'));

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const issues = (p) => { const r = rules.processSchema.safeParse(p); return r.success ? [] : r.error.issues.map((i) => i.message); };

// ----- the rules a process keeps -----
for (const preset of rules.presets) eq(issues(preset.process), [], `the « ${preset.label} » model is a valid process`);
eq(rules.readProcess(undefined), rules.oneCoreProcess, 'no stored process is the One Core’s');
eq(rules.readProcess({ statuses: 'nope' }), rules.oneCoreProcess, 'an unreadable one too');
const video = rules.presetProcess('video');
const without = (behaviour) => ({ ...video, statuses: video.statuses.filter((s) => s.behaviour !== behaviour) });
ok(issues(without('done')).includes('Il faut au moins un statut « Terminé ».'), 'a process needs a « done » status');
ok(issues({ ...video, statuses: [...video.statuses, { id: 'x', label: 'Encore client', color: 'red', behaviour: 'client' }] }).includes('Un seul statut « Chez le client ».'), 'one client status at most');
ok(issues({ ...video, statuses: [...video.statuses, { id: 'y', label: 'Montage', color: 'red', behaviour: 'work' }] }).includes('Deux statuts portent le même nom.'), 'names are unique');
ok(issues({ ...video, pages: { ...video.pages, tasks: { on: false, group: 'work' } } }).includes('Les pages Tâches et Équipe restent toujours actives.'), 'the task page stays on');
eq([rules.startStatus(video), rules.workStatus(video), rules.firstOf(video, 'client'), rules.firstOf(video, 'done')], ['brief', 'preprod', 'client', 'delivered'], 'where the engine sends a task in the video process');
const noClock = { ...video, statuses: video.statuses.map((s) => (s.id === 'preprod' ? { ...s, clock: false } : s)) };
eq([rules.runsClock('edit', video), rules.runsClock('preprod', noClock), rules.runsClock('brief', video), rules.runsClock('paused', video)], [true, false, false, false], 'the clock runs in production statuses only, unless turned off');
eq(rules.statusByName(video, 'montage'), 'edit', 'a status can be named by its label');

// ----- the engine follows behaviours -----
const task = { id: 't', kind: 'task', revision: 1, name: 'Film', clientId: 'c', status: 'edit', createdAt: '2026-10-01T09:00:00.000Z', deliverable: 'https://drive.test/film.mp4' };
const now = '2026-10-10T09:00:00.000Z';
eq(rules.submitForReview(task, now, undefined, video).status, 'internal', 'the internal check lands on the studio’s own status');
const sent = rules.sendForValidation(task, now, video);
eq([sent.status, !!sent.approvalDueAt, rules.courtOf(sent, video)], ['client', true, 'client'], 'sent to the client starts its clock');
eq(rules.approve(sent, { mode: 'explicit', by: 'Lina', at: now, round: 0 }, video).status, 'delivered', 'the client’s approval lands on the first « done » status');
eq(rules.requestChanges(sent, 'Lina', now, video).status, 'preprod', 'changes go back to the first production step');
eq(['brief', 'edit', 'paused', 'internal', 'client', 'delivered'].map((status) => rules.clientTaskCopy({ ...task, status }, video).status), ['À faire', 'En cours', 'En pause', 'En cours', 'À valider', 'Validé'], 'the client reads behaviours, never the studio’s step names');
const late = { ...sent, approvalDueAt: '2026-10-09T09:00:00.000Z' };
eq(rules.sweep([late], new Date(now), video).tasks[0]?.status, 'delivered', 'silence approves into the studio’s « done » status');
eq(rules.taskStatusOrder(video).slice(0, 3), ['internal', 'client', 'brief'], 'decisions come first in the board and the « by status » sort');

// ----- through the records API -----
const { db, pg } = await createTestDb();
globalThis.testDb = db;
globalThis.testEnv = { OWNER_EMAIL: 'owner@studio.test' };
const owner = { userId: 'owner-a', fullName: 'Owner', displayName: 'Owner', email: 'owner@studio.test' };
globalThis.testUser = owner;
const { GET, POST } = await import(pathToFileURL(process.cwd() + '/.sites-runtime/process-test.mjs'));
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
const person = (userId) => ({ userId, fullName: userId, displayName: userId, email: `${userId}@studio.test` });
async function seed(userId, role, clientId = null) {
  await pg.query('INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4)', [userId, userId, `${userId}@studio.test`, 'x']);
  await pg.query('INSERT INTO workspace_members (workspace_id, user_id, role, name, email, client_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, now())', [WS, userId, role, userId, `${userId}@studio.test`, clientId]);
}
const day = (offset) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };

assert.equal((await GET(new Request('https://tracker.test/api/records'))).status, 200);
const client = await post({ action: 'create', kind: 'client', data: { name: 'Atelier Atlas' } });
await seed('admin', 'admin'); await seed('yasmine', 'creative'); await seed('lina', 'client', client.id);

let page = await get();
eq([page.process.preset, page.processRevision], ['one-core', 0], 'a studio starts on the One Core’s process');

// Only the owner changes the process, with a valid process and the latest version.
as(person('admin')); await post({ action: 'process-save', data: video, revision: 0 }, 403);
as(owner);
await post({ action: 'process-save', data: without('done'), revision: 0 }, 400);
await post({ action: 'process-save', data: video, revision: 3 }, 409);
const saved = await post({ action: 'process-save', data: { ...video, pages: { ...video.pages, crm: { on: false, group: 'studio' }, meetings: { on: true, group: 'work', label: 'Rendez-vous' } } }, revision: 0 });
eq([saved.process.preset, saved.processRevision, saved.process.pages.crm.on, saved.process.pages.meetings.label], ['video', 1, false, 'Rendez-vous'], 'the owner’s process and pages are saved');
as(person('admin')); ok(!(await get()).process.pages.crm.on, 'everyone gets the studio’s pages');
as(person('lina')); ok(!('process' in (await get())), 'a client contact never receives the studio’s process');
as(owner);

// Tasks start in the studio's first status and only take its statuses.
const base = { name: 'Film de marque', clientId: client.id, due: day(30), source: 'Interne' };
const created = await post({ action: 'create', kind: 'task', data: base });
let row = created.records.find((r) => r.id === created.id);
eq(row.status, 'brief', 'a new task starts in « Brief »');
await post({ action: 'update', kind: 'task', id: row.id, revision: row.revision, data: { ...base, status: 'À faire' } }, 400);
let next = await post({ action: 'update', kind: 'task', id: row.id, revision: row.revision, data: { ...base, status: 'shoot' } });
row = next.records.find((r) => r.id === row.id);
eq(row.status, 'shoot', 'a task moves to « Tournage »');
// A deliverable link sends the work to the internal check, then the owner sends it to the client.
next = await post({ action: 'update', kind: 'task', id: row.id, revision: row.revision, data: { ...base, status: 'shoot', deliverable: 'https://drive.test/v1.mp4' } });
row = next.records.find((r) => r.id === row.id);
eq(row.status, 'internal', 'a new deliverable goes to « Validation interne »');
next = await post({ action: 'internal-review', taskId: row.id, revision: row.revision, decision: 'send' });
row = next.records.find((r) => r.id === row.id);
eq([row.status, !!row.approvalDueAt], ['client', true], 'sent to « Chez le client » with its approval clock');
// The client reads it in their words and approves: it lands on « Livré ».
as(person('lina'));
const portal = await get();
eq(portal.records.find((r) => r.id === row.id)?.status, 'À valider', 'the client sees « À valider »');
await post({ action: 'approve', taskId: row.id });
as(owner);
row = (await get()).records.find((r) => r.id === row.id);
eq([row.status, row.signOff?.mode], ['delivered', 'explicit'], 'approved into « Livré » with the client’s sign-off');

// A member moves work along but never marks it done.
const work = await post({ action: 'create', kind: 'task', data: { ...base, name: 'Making-of', assignee: 'yasmine' } });
let w = work.records.find((r) => r.id === work.id);
as(person('yasmine'));
await post({ action: 'update', kind: 'task', id: w.id, revision: w.revision, data: { ...base, name: 'Making-of', assignee: 'yasmine', status: 'delivered' } }, 403);
const moved = await post({ action: 'update', kind: 'task', id: w.id, revision: w.revision, data: { ...base, name: 'Making-of', assignee: 'yasmine', status: 'edit' } });
w = moved.records.find((r) => r.id === w.id);
await post({ action: 'start-timer', taskId: w.id });
w = (await get()).records.find((r) => r.id === w.id);
ok(w.timeEntries?.some((e) => !e.end), 'the clock runs in « Montage »');
const paused = await post({ action: 'update', kind: 'task', id: w.id, revision: w.revision, data: { ...base, name: 'Making-of', assignee: 'yasmine', status: 'paused' } });
w = paused.records.find((r) => r.id === w.id);
ok(w.timeEntries.every((e) => e.end), 'pausing stops it');
as(owner);

// Removing a status that tasks still use asks where they go, then moves them with the process.
const shrunk = { ...saved.process, statuses: saved.process.statuses.filter((s) => s.id !== 'paused') };
const refused = await post({ action: 'process-save', data: shrunk, revision: 1 }, 409);
eq([refused.code, refused.statuses.map((s) => [s.id, s.count])], ['replace', [['paused', 1]]], 'the answer names the status and how many tasks use it');
await post({ action: 'process-save', data: shrunk, revision: 1, replacements: { paused: 'nope' } }, 409);
const replaced = await post({ action: 'process-save', data: shrunk, revision: 1, replacements: { paused: 'preprod' } });
w = replaced.records.find((r) => r.id === w.id);
eq([w.status, replaced.processRevision], ['preprod', 2], 'the task moved to « Pré-production » with the new process');
ok(w.history.some((h) => h.text.startsWith('Statut remplacé : En pause → Pré-production')), 'the move is in its history');

console.log(`${checks} process checks passed: the rules a process keeps, the four models, behaviours driving the engine, the owner-only save, a video studio from brief to « Livré », the client’s words, members, the clock, removed statuses and pages.`);
