// Work types (lib/process.ts): one studio, several kinds of work, each with its own path of statuses. A
// full-service studio delivers Reels (idea → edit → internal check → client → published) and SEO
// articles (keyword → writing → client → live); every transition follows the task's own path, the API
// keeps each task on its path, and moving a task to another work type lands it on the matching step.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';

const esbuild = await import(pathToFileURL(globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0]));
mkdirSync('.sites-runtime', { recursive: true });
await esbuild.build({ entryPoints: ['app/api/records/route.ts'], outfile: '.sites-runtime/work-types-test.mjs', bundle: true, platform: 'node', format: 'esm', plugins: [testRuntimePlugin({ auth: false })], logLevel: 'error' });
await esbuild.build({ stdin: { contents: "export * from './lib/process'; export { approve, passCheck, rejectInternally, requestChanges, sendForValidation, submitForReview } from './lib/flow';", resolveDir: process.cwd() }, outfile: '.sites-runtime/work-types-rules.mjs', bundle: true, platform: 'node', format: 'esm', logLevel: 'error' });
const rules = await import(pathToFileURL(process.cwd() + '/.sites-runtime/work-types-rules.mjs'));

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const issues = (p) => { const r = rules.processSchema.safeParse(p); return r.success ? [] : r.error.issues.map((i) => i.message); };

const s = (id, label, behaviour, color = 'blue') => ({ id, label, behaviour, color });
const fullService = {
  ...rules.oneCoreProcess,
  preset: 'full-service',
  statuses: [
    s('idea', 'Idée', 'todo', 'gray'), s('edit', 'Montage', 'work'), s('check', 'Check DA', 'internal', 'purple'),
    s('client', 'Chez le client', 'client', 'orange'), s('published', 'Publié', 'done', 'green'),
    s('keyword', 'Mot-clé', 'todo', 'gray'), s('writing', 'Rédaction', 'work', 'teal'), s('live', 'En ligne', 'done', 'green'),
  ],
  workTypes: [
    { id: 'reel', label: 'Reel', statusIds: ['idea', 'edit', 'check', 'client', 'published'] },
    { id: 'seo', label: 'Article SEO', statusIds: ['keyword', 'writing', 'client', 'live'] },
  ],
};

// ----- the rules -----
eq(issues(fullService), [], 'two paths sharing « Chez le client » form a valid process');
ok(issues({ ...fullService, workTypes: [...fullService.workTypes, { id: 'x', label: 'Story', statusIds: ['idea', 'edit'] }] })
  .includes('Il faut au moins un statut « Terminé » dans « Story ».'), 'each path needs a way to finish');
ok(issues({ ...fullService, workTypes: [{ id: 'x', label: 'Story', statusIds: ['idea', 'nope', 'published'] }] })
  .includes('« Story » utilise un statut qui n’existe pas.'), 'a path uses only the studio’s statuses');
ok(issues({ ...fullService, workTypes: [...fullService.workTypes, { id: 'z', label: 'reel', statusIds: ['idea', 'published'] }] })
  .includes('Deux types de travail portent le même nom.'), 'work type names are unique');
eq(rules.readProcess({ ...fullService, workTypes: [{ id: 'reel', label: 'Reel', statusIds: ['idea', 'gone', 'published'] }] }).workTypes,
  [{ id: 'reel', label: 'Reel', statusIds: ['idea', 'published'] }], 'a stored path naming a removed status keeps the rest');
ok(!rules.readProcess(fullService).workTypes.some((w) => w.statusIds.includes('gone')));

// ----- each task sees its own path -----
eq(rules.flowFor(fullService, { workType: 'seo' }).statuses.map((x) => x.id), ['keyword', 'writing', 'client', 'live'], 'an SEO article’s path');
eq(rules.flowFor(fullService, {}).statuses.map((x) => x.id), ['idea', 'edit', 'check', 'client', 'published'], 'without a work type: the studio’s first');
eq(rules.flowFor(rules.oneCoreProcess, { workType: 'seo' }), rules.oneCoreProcess, 'a studio without work types has one path');
eq([rules.statusInFlow(fullService, 'edit', 'seo'), rules.statusInFlow(fullService, 'client', 'seo'), rules.statusInFlow(fullService, 'check', 'seo')],
  ['writing', 'client', 'keyword'], 'moving to another path: same behaviour, shared status kept, else the start');

const now = '2026-10-10T09:00:00.000Z';
const article = { id: 'a', kind: 'task', revision: 1, name: 'Guide SEO', workType: 'seo', status: 'writing', deliverable: 'https://docs.test/a', createdAt: now };
const reel = { ...article, id: 'r', name: 'Reel lancement', workType: 'reel', status: 'edit' };
eq(rules.submitForReview(article, now, undefined, fullService).status, 'writing', 'an article has no internal check: it stays put');
eq(rules.submitForReview(reel, now, undefined, fullService).status, 'check', 'a Reel goes to « Check DA »');
const sentArticle = rules.sendForValidation(article, now, fullService);
eq(sentArticle.status, 'client');
eq(rules.approve(sentArticle, { mode: 'explicit', by: 'Lina', at: now, round: 0 }, fullService).status, 'live', 'an approved article goes « En ligne »');
eq(rules.approve(rules.sendForValidation(reel, now, fullService), { mode: 'explicit', by: 'Lina', at: now, round: 0 }, fullService).status, 'published', 'an approved Reel is « Publié »');
eq(rules.requestChanges(sentArticle, 'Lina', now, fullService).status, 'writing', 'changes send an article back to « Rédaction », not « Montage »');

// ----- through the records API -----
const { db, pg } = await createTestDb();
globalThis.testDb = db;
globalThis.testEnv = { OWNER_EMAIL: 'owner@studio.test' };
const owner = { userId: 'owner-a', fullName: 'Owner', displayName: 'Owner', email: 'owner@studio.test' };
globalThis.testUser = owner;
const { GET, POST } = await import(pathToFileURL(process.cwd() + '/.sites-runtime/work-types-test.mjs'));
const WS = 'ws:owner-a';
async function post(body, status = 200) {
  const r = await POST(new Request('https://tracker.test/api/records', { method: 'POST', headers: { 'Content-Type': 'application/json', origin: 'https://tracker.test', 'X-Workspace-Id': WS }, body: JSON.stringify(body) }));
  const d = await r.json(); assert.equal(r.status, status, JSON.stringify(d)); checks++; return d;
}
const day = (offset) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
assert.equal((await GET(new Request('https://tracker.test/api/records'))).status, 200);
void pg;

const client = await post({ action: 'create', kind: 'client', data: { name: 'Atelier Atlas' } });
const saved = await post({ action: 'process-save', data: fullService, revision: 0 });
eq(saved.process.workTypes.map((w) => w.id), ['reel', 'seo'], 'the studio’s work types are saved');

const base = { clientId: client.id, due: day(30), source: 'Interne' };
let made = await post({ action: 'create', kind: 'task', data: { ...base, name: 'Reel menu' } });
let task = made.records.find((r) => r.id === made.id);
eq([task.workType, task.status], ['reel', 'idea'], 'without a work type, a task is the first one and starts on its path');
made = await post({ action: 'create', kind: 'task', data: { ...base, name: 'Article guide', workType: 'seo' } });
let seo = made.records.find((r) => r.id === made.id);
eq([seo.workType, seo.status], ['seo', 'keyword'], 'an SEO article starts at « Mot-clé »');
await post({ action: 'create', kind: 'task', data: { ...base, name: 'X', workType: 'podcast' } }, 400);
await post({ action: 'update', kind: 'task', id: seo.id, revision: seo.revision, data: { ...base, name: 'Article guide', workType: 'seo', status: 'edit' } }, 400);

let next = await post({ action: 'update', kind: 'task', id: task.id, revision: task.revision, data: { ...base, name: 'Reel menu', status: 'edit' } });
task = next.records.find((r) => r.id === task.id);
next = await post({ action: 'update', kind: 'task', id: task.id, revision: task.revision, data: { ...base, name: 'Reel menu', workType: 'seo' } });
task = next.records.find((r) => r.id === task.id);
eq([task.workType, task.status], ['seo', 'writing'], 'turned into an article, work in progress stays in progress on the new path');

// A deliverable on an article (no internal check in its path) does not jump to the Reel's « Check DA ».
next = await post({ action: 'update', kind: 'task', id: seo.id, revision: seo.revision, data: { ...base, name: 'Article guide', workType: 'seo', status: 'writing' } });
seo = next.records.find((r) => r.id === seo.id);
next = await post({ action: 'update', kind: 'task', id: seo.id, revision: seo.revision, data: { ...base, name: 'Article guide', workType: 'seo', status: 'writing', deliverable: 'https://docs.test/guide' } });
seo = next.records.find((r) => r.id === seo.id);
eq(seo.status, 'writing', 'no internal check on this path: the link is saved, the article stays in « Rédaction »');

// ----- chains of internal checks -----
// A Reel now passes the account manager, then the art director; an internal brief has no client step.
const chained = {
  ...fullService,
  statuses: [...fullService.statuses, s('am', 'Check AM', 'internal', 'indigo'), s('memo', 'Note', 'todo', 'gray'), s('filed', 'Classé', 'done', 'green')],
  workTypes: [
    { id: 'reel', label: 'Reel', statusIds: ['idea', 'edit', 'am', 'check', 'client', 'published'] },
    { id: 'seo', label: 'Article SEO', statusIds: ['keyword', 'writing', 'client', 'live'] },
    { id: 'memo', label: 'Brief interne', statusIds: ['memo', 'writing', 'check', 'filed'] },
  ],
};
eq(issues(chained), [], 'two internal checks in a row are a valid path');
const reelPath = rules.flowFor(chained, { workType: 'reel' });
eq([rules.nextCheck(reelPath, 'am'), rules.nextCheck(reelPath, 'check'), rules.nextCheck(reelPath, 'edit')], ['check', null, null], 'the check after « Check AM » is « Check DA », and that one is the last');
const atAm = { ...reel, status: 'am' };
const first = rules.passCheck(atAm, 'Sara', now, chained);
eq([first.to, first.task.status, first.task.approvalDueAt], ['check', 'check', undefined], 'passing the first check moves on to the next; no client clock yet');
const second = rules.passCheck(first.task, 'Yasmine', now, chained);
eq([second.to, second.task.status, !!second.task.approvalDueAt], ['client', 'client', true], 'after the last check, the client’s clock starts');
const memo = rules.passCheck({ ...article, workType: 'memo', status: 'check' }, 'Sara', now, chained);
eq([memo.to, memo.task.status, memo.task.signOff?.mode], ['done', 'filed', 'studio'], 'no client step: the studio’s check finishes it');
eq(rules.rejectInternally(first.task, 'Le son est trop fort.', 'Yasmine', now, chained).status, 'edit', 'a refusal at any check goes back to work');

await post({ action: 'process-save', data: chained, revision: 1 });
made = await post({ action: 'create', kind: 'task', data: { ...base, name: 'Reel lancement', workType: 'reel', status: 'edit' } });
let chainTask = made.records.find((r) => r.id === made.id);
next = await post({ action: 'update', kind: 'task', id: chainTask.id, revision: chainTask.revision, data: { ...base, name: 'Reel lancement', workType: 'reel', status: 'edit', deliverable: 'https://drive.test/reel.mp4' } });
chainTask = next.records.find((r) => r.id === chainTask.id);
eq(chainTask.status, 'am', 'a new deliverable goes to the first check of the chain');
next = await post({ action: 'internal-review', taskId: chainTask.id, revision: chainTask.revision, decision: 'send' });
chainTask = next.records.find((r) => r.id === chainTask.id);
eq([next.next, chainTask.status], ['check', 'check'], 'the account manager passes it on to the art director');
next = await post({ action: 'internal-review', taskId: chainTask.id, revision: chainTask.revision, decision: 'send' });
chainTask = next.records.find((r) => r.id === chainTask.id);
eq([next.next, chainTask.status], ['client', 'client'], 'the art director sends it to the client');

// ----- a work type removed, a path edited -----
// « Brief interne » goes while a brief still uses it: the save asks where its tasks go, then moves them.
made = await post({ action: 'create', kind: 'task', data: { ...base, name: 'Brief rentrée', workType: 'memo' } });
let brief = made.records.find((r) => r.id === made.id);
made = await post({ action: 'create', kind: 'task', data: { ...base, name: 'Reel coulisses', workType: 'reel', status: 'edit' } });
let cut = made.records.find((r) => r.id === made.id);
eq([brief.status, cut.status], ['memo', 'edit']);
// The Reel path also drops « Montage »: a reel still in it takes its path's nearest step.
const trimmed = { ...chained, workTypes: [{ id: 'reel', label: 'Reel', statusIds: ['idea', 'am', 'check', 'client', 'published'] }, chained.workTypes[1]] };
const asked = await post({ action: 'process-save', data: trimmed, revision: 2 }, 409);
eq([asked.code, asked.statuses, asked.types], ['replace', [], [{ id: 'memo', label: 'Brief interne', count: 1 }]], 'the answer names the removed type and how many tasks use it');
await post({ action: 'process-save', data: trimmed, revision: 2, typeReplacements: { memo: 'nope' } }, 409);
next = await post({ action: 'process-save', data: trimmed, revision: 2, typeReplacements: { memo: 'seo' } });
brief = next.records.find((r) => r.id === brief.id);
cut = next.records.find((r) => r.id === cut.id);
eq([brief.workType, brief.status], ['seo', 'keyword'], 'the brief becomes an SEO article, at its path’s start');
ok(brief.history.some((h) => h.text.startsWith('Type de travail remplacé : Brief interne → Article SEO')), 'its history says so');
eq(cut.status, 'idea', 'the reel left in « Montage » goes back to its path’s start: no work step left on it');
ok(cut.history.some((h) => h.text.startsWith('Statut ajusté au chemin : Montage → Idée')));
eq(next.records.find((r) => r.id === chainTask.id).status, 'client', 'a task whose step is still on its path doesn’t move');

// No work types left: the tasks simply follow the studio's single path, no question asked.
const single = { ...trimmed, workTypes: undefined };
next = await post({ action: 'process-save', data: single, revision: 3 });
brief = next.records.find((r) => r.id === brief.id);
eq([brief.workType, brief.status], [undefined, 'keyword'], 'the type is dropped; the status stays');
ok(brief.history.some((h) => h.text.startsWith('Type de travail retiré : Article SEO')));

console.log(`work types: ${checks} checks passed`);
