// Each studio's own rules (lib/process.ts rulesOf, lib/workflow-settings.ts onSilence): the freeze before
// publishing, the milestones counted back from the publishing date, the auto-archiving delay, and what a
// client's silence does at the deadline — approve (The One Flow), remind both sides, or alert the studio.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';

const esbuild = await import(pathToFileURL(globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0]));
mkdirSync('.sites-runtime', { recursive: true });
await esbuild.build({ entryPoints: ['app/api/records/route.ts'], outfile: '.sites-runtime/studio-rules-test.mjs', bundle: true, platform: 'node', format: 'esm', plugins: [testRuntimePlugin({ auth: false })], logLevel: 'error' });
await esbuild.build({ stdin: { contents: "export * from './lib/process'; export * from './lib/workflow-settings'; export { gatesFor, insideLock, lockApplies, sweep } from './lib/flow';", resolveDir: process.cwd() }, outfile: '.sites-runtime/studio-rules-lib.mjs', bundle: true, platform: 'node', format: 'esm', logLevel: 'error' });
const lib = await import(pathToFileURL(process.cwd() + '/.sites-runtime/studio-rules-lib.mjs'));

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const issues = (p) => { const r = lib.processSchema.safeParse(p); return r.success ? [] : r.error.issues.map((i) => i.message); };

// ----- the numbers -----
eq(lib.rulesOf(lib.oneCoreProcess), { lockDays: 7, archiveAfterDays: 15, gates: { brief: 14, send: 7, validation: 5, ready: 1 } }, 'without rules: The One Flow’s numbers');
const quick = { ...lib.oneCoreProcess, rules: { lockDays: 2, archiveAfterDays: 0, gates: { send: 3 } } };
eq(issues(quick), [], 'a studio’s own numbers are a valid process');
eq(lib.rulesOf(quick).gates, { brief: 14, send: 3, validation: 5, ready: 1 }, 'a milestone not set keeps its default');
ok(issues({ ...lib.oneCoreProcess, rules: { lockDays: 45 } }).includes('Trente jours de gel au plus.'), 'the freeze has a limit');

const today = '2026-10-10';
eq([lib.insideLock('2026-10-11', today, 2), lib.insideLock('2026-10-13', today, 2), lib.insideLock('2026-10-11', today, 0)], [true, false, false], 'a two-day freeze; none at 0');
eq(lib.lockApplies(undefined, '2026-10-15', today, 7), true);
eq(lib.lockApplies(undefined, '2026-10-15', today, 2), false, 'outside a two-day freeze, a date moves freely');
const gates = lib.gatesFor({ due: '2026-10-20', status: 'En cours' }, today, quick);
eq(gates.find((g) => g.key === 'send').day, '2026-10-17', 'sent to the client three days before, the studio’s number');

// ----- auto-archiving -----
const now = new Date('2026-10-30T09:00:00.000Z');
const done = { id: 't1', kind: 'task', revision: 1, name: 'Post', clientId: 'c1', status: 'Validé', validatedAt: '2026-10-20T09:00:00.000Z', due: '2026-10-21', createdAt: '2026-10-01T09:00:00.000Z' };
const client = { id: 'c1', kind: 'client', revision: 1, name: 'Kojo', createdAt: '2026-01-01T00:00:00.000Z' };
eq(lib.sweep([client, done], now, lib.oneCoreProcess).tasks.length, 0, 'ten days after approval: kept for now (15 by default)');
eq(lib.sweep([client, done], now, { ...lib.oneCoreProcess, rules: { archiveAfterDays: 5 } }).tasks[0]?.archived, true, 'a studio archiving after 5 days');
eq(lib.sweep([client, { ...done, validatedAt: '2026-01-01T09:00:00.000Z' }], now, quick).tasks.length, 0, 'never, when the studio says 0');

// ----- what silence does -----
const waiting = (onSilence) => ({ id: 't2', kind: 'task', revision: 1, name: 'Reel', clientId: 'c1', status: 'À valider', sentAt: '2026-10-27T09:00:00.000Z',
  approvalDueAt: '2026-10-29T09:00:00.000Z', approvalSettings: { validationHours: 48, maxRevisionRounds: 2, ...(onSilence ? { onSilence } : {}) }, deliverable: 'https://drive.test/r', createdAt: '2026-10-01T09:00:00.000Z' });
let run = lib.sweep([client, waiting()], now);
eq([run.tasks[0]?.status, run.events[0]?.type], ['Validé', 'auto-approved'], 'approve (the default): silence approves');
run = lib.sweep([client, waiting('remind')], now);
eq([run.tasks[0]?.status, run.tasks[0]?.reminders, run.events[0]?.type, run.events[0]?.audience], ['À valider', ['overdue'], 'reminder', 'both'], 'remind: both sides are told, the work keeps waiting');
eq(lib.sweep([client, run.tasks[0]], now).events.length, 0, 'told once');
run = lib.sweep([client, waiting('escalate')], now);
eq([run.tasks[0]?.status, run.events[0]?.type, run.events[0]?.audience], ['À valider', 'escalation', 'studio'], 'escalate: the studio is alerted, the client is not');
const early = lib.sweep([client, { ...waiting('remind'), approvalDueAt: '2026-10-30T12:00:00.000Z' }], now).events[0];
ok(early?.name.includes('attend la validation du client') && !early.name.includes('tacitement'), 'without tacit approval, a reminder never promises one');

// The studio's choice reaches clients with their own deadline; an accepted contract keeps its numbers.
const studio = { validationHours: 48, maxRevisionRounds: 2, onSilence: 'remind' };
const own = { ...client, workflowSettings: { validationHours: 24, maxRevisionRounds: 1 } };
eq(lib.clientWorkflowSettings([own], 'c1', studio, today), { validationHours: 24, maxRevisionRounds: 1, onSilence: 'remind' });
eq(lib.clientWorkflowSettings([{ ...own, workflowSettings: { validationHours: 24, maxRevisionRounds: 1, onSilence: 'approve' } }], 'c1', studio, today).onSilence, 'approve', 'a client’s own choice wins');

// ----- through the records API: the studio's freeze -----
const { db } = await createTestDb();
globalThis.testDb = db;
globalThis.testEnv = { OWNER_EMAIL: 'owner@studio.test' };
globalThis.testUser = { userId: 'owner-a', fullName: 'Owner', displayName: 'Owner', email: 'owner@studio.test' };
const { GET, POST } = await import(pathToFileURL(process.cwd() + '/.sites-runtime/studio-rules-test.mjs'));
async function post(body, status = 200) {
  const r = await POST(new Request('https://tracker.test/api/records', { method: 'POST', headers: { 'Content-Type': 'application/json', origin: 'https://tracker.test', 'X-Workspace-Id': 'ws:owner-a' }, body: JSON.stringify(body) }));
  const d = await r.json(); assert.equal(r.status, status, JSON.stringify(d)); checks++; return d;
}
const day = (offset) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
assert.equal((await GET(new Request('https://tracker.test/api/records'))).status, 200);
const kojo = await post({ action: 'create', kind: 'client', data: { name: 'Kojo Bakery' } });
await post({ action: 'process-save', data: { ...lib.oneCoreProcess, rules: { lockDays: 2 } }, revision: 0 });
await post({ action: 'create', kind: 'task', data: { name: 'Story', clientId: kojo.id, due: day(4), source: 'Interne' } });
const locked = await post({ action: 'create', kind: 'task', data: { name: 'Story', clientId: kojo.id, due: day(1), source: 'Interne' } }, 409);
eq([locked.code, locked.error.includes('J−2')], ['lock', true], 'inside the studio’s two-day freeze, the owner is asked to confirm');

console.log(`studio rules: ${checks} checks passed`);
