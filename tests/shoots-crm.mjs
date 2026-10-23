// Shooting sessions (lib/shoots.ts) and the CRM (lib/crm.ts) through the records API: who plans and sees
// what, the crew's notices and conflicts, the client's confirmation, prospects and their conversion.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';

const esbuild = await import(pathToFileURL(globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0] || 'node_modules/esbuild/lib/main.js'));
mkdirSync('.sites-runtime', { recursive: true });
await esbuild.build({ entryPoints: ['app/api/records/route.ts'], outfile: '.sites-runtime/shoots-crm-test.mjs', bundle: true, platform: 'node', format: 'esm', plugins: [testRuntimePlugin({ auth: false })], logLevel: 'error' });
await esbuild.build({ stdin: { contents: "export * from './lib/shoots'; export * from './lib/crm';", resolveDir: process.cwd() }, outfile: '.sites-runtime/shoots-crm-rules.mjs', bundle: true, platform: 'node', format: 'esm', logLevel: 'error' });
const rules = await import(pathToFileURL(process.cwd() + '/.sites-runtime/shoots-crm-rules.mjs'));
const { db, pg } = await createTestDb();
globalThis.testDb = db;
globalThis.testEnv = { OWNER_EMAIL: 'owner@studio.test' };
const owner = { userId: 'owner-a', fullName: 'Owner', displayName: 'Owner', email: 'owner@studio.test' };
globalThis.testUser = owner;
const { GET, POST } = await import(pathToFileURL(process.cwd() + '/.sites-runtime/shoots-crm-test.mjs'));

let checks = 0;
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
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const day = (offset) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
const person = (userId, name) => ({ userId, fullName: name, displayName: name, email: `${userId}@studio.test` });
async function seed(userId, role, clientId = null) {
  await pg.query('INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4)', [userId, userId, `${userId}@studio.test`, 'x']);
  await pg.query('INSERT INTO workspace_members (workspace_id, user_id, role, name, email, client_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, now())', [WS, userId, role, userId, `${userId}@studio.test`, clientId]);
}

// The owner's first request (no workspace named) creates their studio.
assert.equal((await GET(new Request('https://tracker.test/api/records'))).status, 200);
const client = await post({ action: 'create', kind: 'client', data: { name: 'Atelier Atlas' } });
const other = await post({ action: 'create', kind: 'client', data: { name: 'Other Client' } });
await seed('yasmine', 'creative'); await seed('omar', 'creative'); await seed('nora', 'social'); await seed('view', 'viewer'); await seed('admin', 'admin');
await seed('lina', 'client', client.id);
const yasmine = person('yasmine', 'yasmine'), omar = person('omar', 'omar'), nora = person('nora', 'nora'), viewer = person('view', 'view'), admin = person('admin', 'admin'), lina = person('lina', 'lina');

// ----- shoots: planning rules -----
const shoot = { name: 'Lookbook automne', shootType: 'external', clientId: client.id, due: day(10), time: '09:00', duration: 240, location: 'Médina, Marrakech', attendees: ['yasmine'], externalCrew: 'Karim (drone, freelance)', description: 'Apportez 6 tenues.' };
await post({ action: 'shoot-save', data: { ...shoot, clientId: '' } }, 400);
await post({ action: 'shoot-save', data: { ...shoot, attendees: ['lina'] } }, 400);
await post({ action: 'shoot-save', data: { ...shoot, time: '25:00' } }, 400);
const planned = await post({ action: 'shoot-save', data: shoot });
let row = planned.records.find((r) => r.id === planned.id);
eq([row.kind, row.shootType, row.attendeeNames, row.location], ['shoot', 'external', ['yasmine'], 'Médina, Marrakech'], 'the shoot is saved with its crew and place');
ok(planned.records.some((r) => r.kind === 'event' && r.shootId === planned.id && r.recipients?.includes('yasmine')), 'the crew is told');
ok(planned.records.some((r) => r.kind === 'event' && r.shootId === planned.id && r.audience === 'client'), 'the client is told');
const internal = await post({ action: 'shoot-save', data: { name: 'Contenu de l’agence', shootType: 'internal', due: day(11), time: '14:00', duration: 120, attendees: ['omar'] } });
ok(!internal.records.find((r) => r.id === internal.id).clientId, 'an internal shoot needs no client');
const clash = await post({ action: 'shoot-save', data: { ...shoot, name: 'Autre shooting', clientId: other.id, time: '11:00', duration: 60 } });
ok(clash.conflicts?.some((c) => c.startsWith('yasmine')), 'a crew member booked at the same time is flagged, and the shoot saved anyway');
as(nora); const byNora = await post({ action: 'shoot-save', data: { ...shoot, name: 'Par Nora', due: day(20), attendees: [] } });
as(yasmine); await post({ action: 'shoot-save', data: { ...shoot, name: 'Par Yasmine' } }, 403);

// ----- shoots: who sees what -----
eq((await get()).records.filter((r) => r.kind === 'shoot').map((r) => r.name).sort(), ['Autre shooting', 'Lookbook automne'], 'a team member sees the shoots they are on');
as(omar); eq((await get()).records.filter((r) => r.kind === 'shoot').map((r) => r.name), ['Contenu de l’agence'], 'and not the others');
as(viewer); eq((await get()).records.filter((r) => r.kind === 'shoot').length, 4, 'a viewer sees every shoot');
as(lina);
const portal = await get();
const theirs = portal.records.filter((r) => r.kind === 'shoot');
eq(theirs.map((r) => r.name).sort(), ['Lookbook automne', 'Par Nora'], 'the client sees only their own shoots');
ok(theirs.every((r) => !('attendees' in r) && !('externalCrew' in r) && !('authorId' in r)), 'without the studio ids or outside crew');
ok(theirs.find((r) => r.id === planned.id).attendeeNames?.includes('yasmine'), 'but with who comes');

// ----- shoots: the client answers -----
await post({ action: 'shoot-answer', id: planned.id, decision: 'reschedule' }, 400);
await post({ action: 'shoot-answer', id: internal.id, decision: 'confirm' }, 404);
const confirmed = await post({ action: 'shoot-answer', id: planned.id, decision: 'confirm' });
eq(confirmed.records.find((r) => r.id === planned.id).clientDecision.state, 'confirmed', 'the client confirms');
as(owner);
const told = await get();
ok(told.records.some((r) => r.kind === 'event' && r.shootId === planned.id && r.name.includes('a confirmé') && r.recipients?.includes('yasmine')), 'the crew hears the answer');
row = told.records.find((r) => r.id === planned.id);
const moved = await post({ action: 'shoot-save', id: planned.id, revision: row.revision, data: { ...shoot, due: day(12) } });
eq(moved.records.find((r) => r.id === planned.id).clientDecision, undefined, 'a new date asks the client again');
as(lina);
await post({ action: 'shoot-answer', id: planned.id, decision: 'reschedule', note: 'Plutôt le samedi.' });
as(owner);
await post({ action: 'shoot-cancel', id: byNora.id });
as(lina); await post({ action: 'shoot-answer', id: byNora.id, decision: 'confirm' }, 409);
as(yasmine); await post({ action: 'shoot-done', id: planned.id }, 403);
as(owner);
const done = await post({ action: 'shoot-done', id: internal.id });
ok(done.records.find((r) => r.id === internal.id).endedAt, 'a shoot is marked done');

// ----- the CRM: who works it -----
const lead = { name: 'Café Bahia', contact: 'Sara', email: 'sara@bahia.test', city: 'Casablanca', source: 'Instagram', estimatedValue: 6000, due: day(-1), prospectStage: 'new' };
for (const user of [yasmine, nora, viewer, lina]) { as(user); await post({ action: 'prospect-save', data: lead }, 403); }
as(viewer); ok(!(await get()).records.some((r) => r.kind === 'prospect'), 'a viewer never sees prospects');
as(admin);
const saved = await post({ action: 'prospect-save', data: lead });
await post({ action: 'prospect-save', data: { ...lead, email: 'not-an-email' } }, 400);
await post({ action: 'prospect-save', data: { ...lead, prospectStage: 'won' } }, 400);
let prospect = saved.records.find((r) => r.id === saved.id);
const movedLead = await post({ action: 'prospect-stage', id: prospect.id, revision: prospect.revision, stage: 'proposal' });
prospect = movedLead.records.find((r) => r.id === prospect.id);
eq(prospect.prospectStage, 'proposal', 'a card moves between stages');
await post({ action: 'prospect-stage', id: prospect.id, revision: prospect.revision, stage: 'won' }, 400);
await post({ action: 'prospect-convert', id: prospect.id, revision: prospect.revision }, 403);
as(yasmine); ok(!(await get()).records.some((r) => r.kind === 'prospect'), 'a team member never sees prospects');
as(lina); ok(!(await get()).records.some((r) => r.kind === 'prospect'), 'nor does a client');

// ----- the CRM: winning a prospect -----
as(owner);
const converted = await post({ action: 'prospect-convert', id: prospect.id, revision: prospect.revision });
const newClient = converted.records.find((r) => r.kind === 'client' && r.id === converted.id);
eq([newClient.name, newClient.contact, newClient.email, newClient.city], ['Café Bahia', 'Sara', 'sara@bahia.test', 'Casablanca'], 'the client carries the prospect’s details');
prospect = converted.records.find((r) => r.id === prospect.id);
eq([prospect.prospectStage, prospect.convertedClientId], ['won', newClient.id], 'the prospect stays on the board, won and linked');
eq((await post({ action: 'prospect-convert', id: prospect.id, revision: prospect.revision })).id, newClient.id, 'converting twice gives the same client');
const twin = await post({ action: 'prospect-save', data: { ...lead, name: 'café bahia' } });
const twinRow = twin.records.find((r) => r.id === twin.id);
await post({ action: 'prospect-convert', id: twin.id, revision: twinRow.revision }, 409);
await post({ action: 'prospect-delete', id: twin.id });
ok(!(await get()).records.some((r) => r.id === twin.id), 'a prospect can be deleted');

// ----- the CRM: closing dates and lost reasons, for the analysis -----
ok(!!prospect.closedAt, 'a won prospect is dated');
await post({ action: 'prospect-stage', id: prospect.id, revision: prospect.revision, stage: 'contacted' }, 409);
const riad = { ...lead, name: 'Riad Zitoun', source: 'Recommandation' };
const gone = await post({ action: 'prospect-save', data: { ...riad, prospectStage: 'contacted' } });
let goneRow = gone.records.find((r) => r.id === gone.id);
ok(!goneRow.closedAt, 'an open prospect has no closing date');
await post({ action: 'prospect-save', id: gone.id, revision: goneRow.revision, data: { ...riad, prospectStage: 'lost', lostReason: 'Trop cher' } }, 400);
const lostSave = await post({ action: 'prospect-save', id: gone.id, revision: goneRow.revision, data: { ...riad, prospectStage: 'lost', lostReason: 'Budget trop serré', lostNote: 'Attendait un devis à 4000' } });
goneRow = lostSave.records.find((r) => r.id === gone.id);
eq([goneRow.lostReason, goneRow.lostNote, !!goneRow.closedAt], ['Budget trop serré', 'Attendait un devis à 4000', true], 'a lost prospect keeps its reason, its note and its date');
const reopened = await post({ action: 'prospect-stage', id: gone.id, revision: goneRow.revision, stage: 'contacted' });
goneRow = reopened.records.find((r) => r.id === gone.id);
eq([goneRow.lostReason, goneRow.lostNote, goneRow.closedAt], [undefined, undefined, undefined], 'reopened, it is no longer lost');
const relost = await post({ action: 'prospect-stage', id: gone.id, revision: goneRow.revision, stage: 'lost' });
ok(!!relost.records.find((r) => r.id === gone.id).closedAt, 'lost again by a drag, it is dated again');

// ----- pure rules -----
const summary = rules.crmSummary([{ id: 'a', kind: 'prospect', name: 'a', prospectStage: 'new', estimatedValue: 5000, due: day(-2), createdAt: '', revision: 1 }, { id: 'b', kind: 'prospect', name: 'b', prospectStage: 'lost', estimatedValue: 9000, createdAt: '', revision: 1 }], day(0));
eq([summary.pipelineValue, summary.followUpsDue], [5000, 1], 'the board counts open value and follow-ups due');
eq(rules.shootPhase({ id: 's', kind: 'shoot', name: 's', due: day(-1), createdAt: '', revision: 1 }, day(0)), 'done', 'a past shoot reads as done');

// The analysis: won over closed, the average of the won values, sources by what they brought, reasons by count.
const at = (d) => `${d}T10:00:00.000Z`;
const P = (id, extra) => ({ id, kind: 'prospect', name: id, revision: 1, createdAt: at(day(-10)), ...extra });
const pool = [
  P('w1', { prospectStage: 'won', source: 'Instagram', estimatedValue: 6000, closedAt: at(day(-2)) }),
  P('w2', { prospectStage: 'won', source: 'Recommandation', estimatedValue: 9000, closedAt: at(day(-3)) }),
  P('w3', { prospectStage: 'won', source: 'Recommandation' }),
  P('l1', { prospectStage: 'lost', source: 'Instagram', lostReason: 'Budget trop serré', closedAt: at(day(-1)) }),
  P('l2', { prospectStage: 'lost', source: 'Instagram', lostReason: 'Budget trop serré', closedAt: at(day(-4)) }),
  P('l3', { prospectStage: 'lost', closedAt: at(day(-5)) }),
  P('o1', { prospectStage: 'meeting', source: 'Instagram', estimatedValue: 4000 }),
  P('old', { prospectStage: 'won', source: 'Site web', estimatedValue: 20000, createdAt: at(day(-400)) }),
];
const quarter = rules.crmInsights(pool, day(0), 'quarter');
eq([quarter.prospects, quarter.won, quarter.lost, quarter.open], [7, 3, 3, 1], 'the period holds the prospects that arrived in it');
eq(quarter.winRate, 0.5, 'win rate: won over closed');
eq([quarter.averageDeal, quarter.wonValue], [7500, 15000], 'the average counts the won prospects that have a value');
eq(quarter.sources.map((s) => [s.source, s.prospects, s.won, s.winRate]), [['Recommandation', 2, 2, 1], ['Instagram', 4, 1, 1 / 3], ['', 1, 0, 0]], 'sources: what they brought first, the unnamed last');
eq(quarter.lostReasons.map((r) => [r.reason, r.count]), [['Budget trop serré', 2], ['', 1]], 'lost reasons, the most frequent first');
eq(quarter.recentLost.map((p) => p.id), ['l1', 'l2', 'l3'], 'the latest losses first');
eq([rules.crmInsights(pool, day(0), 'year').prospects, rules.crmInsights(pool, day(0), 'all').prospects], [7, 8], 'since the start reaches older prospects');
eq([rules.crmInsights([], day(0), 'all').winRate, rules.crmInsights([], day(0), 'all').averageDeal], [null, null], 'nothing closed, no rate and no average');
eq(rules.crmSummary([P('today', { prospectStage: 'won', closedAt: at(day(0)) })], day(0)).wonThisMonth, 1, 'won this month counts by closing date');

console.log(`${checks} shoot and CRM checks passed: planning rules, crew notices and conflicts, who sees which shoot, the client's answer, a new date asking again, prospects for the owner and admins only, stages, conversion to a client, closing dates, lost reasons and the analysis.`);
