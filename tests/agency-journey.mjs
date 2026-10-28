// A whole agency week, end to end through the records API: the owner sets up its own process (two paths, an
// art director's check, fields, the client's words, its numbers), invites its team and its client; the work
// goes through the check to the client, who asks for changes, then approves; internal work is validated at
// home; a work type is removed with its tasks moved. Every person acts as themselves.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';

const esbuild = await import(pathToFileURL(globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0]));
mkdirSync('.sites-runtime', { recursive: true });
await esbuild.build({ entryPoints: ['app/api/records/route.ts'], outfile: '.sites-runtime/agency-journey-test.mjs', bundle: true, platform: 'node', format: 'esm', plugins: [testRuntimePlugin({ auth: false })], logLevel: 'error' });

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const { db, pg } = await createTestDb();
globalThis.testDb = db;
globalThis.testEnv = { OWNER_EMAIL: 'owner@nova.test' };
const owner = { userId: 'owner-a', fullName: 'Nadia', displayName: 'Nadia', email: 'owner@nova.test' };
const as = (u) => { globalThis.testUser = { mustChangePassword: false, ...u }; };
as(owner);
const { GET, POST } = await import(pathToFileURL(process.cwd() + '/.sites-runtime/agency-journey-test.mjs'));
const WS = 'ws:owner-a';
async function post(body, status = 200) {
  const r = await POST(new Request('https://space.test/api/records', { method: 'POST', headers: { 'Content-Type': 'application/json', origin: 'https://space.test', 'X-Workspace-Id': WS }, body: JSON.stringify(body) }));
  const d = await r.json(); assert.equal(r.status, status, `${body.action}: ${JSON.stringify(d).slice(0, 300)}`); checks++; return d;
}
async function get() {
  const r = await GET(new Request('https://space.test/api/records', { headers: { 'X-Workspace-Id': WS } }));
  const d = await r.json(); assert.equal(r.status, 200, JSON.stringify(d)); checks++; return d;
}
const find = (page, id) => page.records.find((r) => r.id === id);
assert.equal((await GET(new Request('https://space.test/api/records'))).status, 200);

// ----- 1. The agency sets itself up -----
const s = (id, label, behaviour, color, extra = {}) => ({ id, label, behaviour, color, ...extra });
let page = await get();
const studio = {
  ...page.process,
  statuses: [s('idea', 'Idée', 'todo', 'gray'), s('edit', 'Montage', 'work', 'blue'), s('da', 'Check DA', 'internal', 'purple', { reviewers: ['role-da'] }),
    s('client', 'Chez le client', 'client', 'orange'), s('done', 'Publié', 'done', 'green'), s('pause', 'En pause', 'paused', 'slate')],
  workTypes: [{ id: 'wt-reel', label: 'Reel', statusIds: ['idea', 'edit', 'da', 'client', 'done', 'pause'] }, { id: 'wt-shoot', label: 'Shooting', statusIds: ['idea', 'edit', 'client', 'done'] }],
  roles: [{ id: 'role-da', label: 'Directeur artistique', base: 'creative', grant: ['review'] }],
  fields: [{ id: 'budget', label: 'Budget pub', type: 'money', unit: 'MAD', client: true }, { id: 'hook', label: 'Accroche', type: 'text' }],
  portal: { words: { client: 'À relire' }, welcome: 'Bienvenue chez Nova.' },
  dashboard: { metrics: [{ id: 'delivered', target: 4 }, { id: 'field:budget', target: 5000, atMost: true }] },
  rules: { lockDays: 3 },
};
let saved = await post({ action: 'process-save', data: studio, revision: page.processRevision ?? 0 });
let revision = saved.processRevision;
const clientId = (await post({ action: 'create', kind: 'client', data: { name: 'Atelier Atlas', quota: '4' } })).id;

// The team and the client, invited; the creative becomes the art director.
let invited = await post({ action: 'invite-member', email: 'yasmine@nova.test', name: 'Yasmine', role: 'creative' });
await post({ action: 'invite-member', email: 'lina@atlas.test', name: 'Lina', role: 'client', clientId });
const roster = (await get()).members;
const yasmineId = roster.find((m) => m.email === 'yasmine@nova.test')?.userId;
const linaId = roster.find((m) => m.email === 'lina@atlas.test')?.userId;
ok(yasmineId && linaId, 'both invitations made accounts');
ok(invited.invitation?.temporaryPassword || invited.temporaryPassword || invited.invitation, 'an invitation to pass on');
await post({ action: 'set-member-studio-role', userId: yasmineId, roleId: 'role-da' });
const yasmine = { userId: yasmineId, fullName: 'Yasmine', displayName: 'Yasmine', email: 'yasmine@nova.test' };
const lina = { userId: linaId, fullName: 'Lina', displayName: 'Lina', email: 'lina@atlas.test' };

// ----- 2. Work starts -----
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const due = day(20);
let made = await post({ action: 'create', kind: 'task', data: { name: 'Reel lancement', clientId, due, source: 'Interne', workType: 'wt-reel', assignee: 'Yasmine', assigneeId: yasmineId, fields: { budget: 1200, hook: 'Avant / après' } } });
const reelId = made.id;
eq(find(made, reelId).status, 'idea', 'the Reel starts on its path’s first step');
await post({ action: 'create', kind: 'task', data: { name: 'X', clientId, due, source: 'Interne', workType: 'wt-shoot', status: 'da' } }, 400);
await post({ action: 'create', kind: 'task', data: { name: 'Y', clientId, due, source: 'Interne', fields: { budget: -5 } } }, 400);
eq((await post({ action: 'create', kind: 'task', data: { name: 'Z', clientId, due: day(1), source: 'Interne' } }, 409)).code, 'lock', 'the agency’s 3-day freeze');

as(yasmine);
page = await get();
ok(find(page, reelId), 'Yasmine sees the Reel assigned to her');
ok(page.workspace.permissions.includes('review'), 'and holds the art director’s review');
await post({ action: 'create', kind: 'task', data: { name: 'Mine', clientId, due, source: 'Interne' } }, 403);
let task = find(page, reelId);
task = find(await post({ action: 'update', kind: 'task', id: reelId, revision: task.revision, data: { ...task, status: 'edit' } }), reelId);
task = find(await post({ action: 'update', kind: 'task', id: reelId, revision: task.revision, data: { ...task, deliverable: 'https://drive.test/reel-v1.mp4' } }), reelId);
eq(task.status, 'da', 'the deliverable goes to the art director’s check');
eq((await post({ action: 'internal-review', taskId: reelId, revision: task.revision, decision: 'send' })).next, 'client', 'the check passed: on to the client');

// ----- 3. The client decides -----
as(lina);
page = await get();
let seen = find(page, reelId);
ok(seen && !('process' in page), 'the client sees her content, never the agency’s process');
eq([page.portal.words.client, page.portal.welcome], ['À relire', 'Bienvenue chez Nova.'], 'in the agency’s words');
eq(seen.fields, { budget: 1200 }, 'the budget shown to clients, not the team’s hook');
ok(!(seen.history ?? []).some((h) => h.internal), 'no internal history');
await post({ action: 'request-changes', taskId: reelId, revision: seen.revision, text: 'Plus court, s’il vous plaît.' });
as(owner);
task = find(await get(), reelId);
eq([task.status, task.revisionRound], ['edit', 1], 'back to work, round 1 counted');

as(yasmine);
task = find(await post({ action: 'update', kind: 'task', id: reelId, revision: task.revision, data: { ...task, deliverable: 'https://drive.test/reel-v2.mp4' } }), reelId);
await post({ action: 'internal-review', taskId: reelId, revision: task.revision, decision: 'send' });
as(lina);
seen = find(await get(), reelId);
eq(seen.deliverable, 'https://drive.test/reel-v2.mp4', 'version 2 reaches the client after the check');
await post({ action: 'approve', taskId: reelId, revision: seen.revision });
as(owner);
task = find(await get(), reelId);
eq([task.status, task.signOff?.mode], ['done', 'explicit'], 'approved, with the client’s receipt');

// ----- 4. The agency's own work, and changing the setup later -----
made = await post({ action: 'create', kind: 'task', data: { name: 'Refonte du site de l’agence', clientId: 'internal', source: 'Interne', workType: 'wt-reel', status: 'edit' } });
let own = find(made, made.id);
own = find(await post({ action: 'update', kind: 'task', id: own.id, revision: own.revision, data: { ...own, deliverable: 'https://drive.test/site.pdf' } }), own.id);
eq(own.status, 'da', 'internal work goes through the check too');
await post({ action: 'internal-review', taskId: own.id, revision: own.revision, decision: 'send' });
eq(find(await get(), own.id).status, 'done', 'and is validated there, never sent to a client');

const shootId = (await post({ action: 'create', kind: 'task', data: { name: 'Shooting printemps', clientId, due, source: 'Interne', workType: 'wt-shoot' } })).id;
const trimmed = { ...studio, workTypes: [studio.workTypes[0]] };
ok((await post({ action: 'process-save', data: trimmed, revision }, 409)).types.some((t) => t.id === 'wt-shoot'), 'removing a work type in use asks where its tasks go');
saved = await post({ action: 'process-save', data: trimmed, revision, typeReplacements: { 'wt-shoot': 'wt-reel' } });
eq(find(saved, shootId).workType, 'wt-reel', 'and moves them');

// ----- 5. Who may do what -----
as(lina);
await post({ action: 'process-save', data: studio, revision: saved.processRevision }, 403);
as(yasmine);
await post({ action: 'set-member-studio-role', userId: yasmineId, roleId: null }, 403);

void pg;
console.log(`agency journey: ${checks} checks passed`);
