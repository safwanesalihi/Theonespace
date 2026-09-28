// Plan Éditorial (lib/content-plan*.ts, /api/content-plan): a month built by hand as a mind map —
// branches, and on each one reels, posts and stories that are real tasks. Creating a month (empty, or
// with last month's branches), branches added and renamed, nodes added, moved to another branch, dated,
// assigned and archived (never deleted), a branch removed with its nodes archived, sharing with the
// client (hidden from the portal until then, read-only, comments through the task thread), duplication,
// archiving a month, and who may do what. No AI anywhere.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';

const esbuildPath = globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0] || 'node_modules/esbuild/lib/main.js';
const esbuild = await import(pathToFileURL(esbuildPath));
mkdirSync('.sites-runtime/content-plan-tests', { recursive: true });
await esbuild.build({
  entryPoints: { password: 'app/api/auth/password/route.ts', records: 'app/api/records/route.ts', plan: 'app/api/content-plan/route.ts', core: 'lib/content-plan.ts' },
  outdir: '.sites-runtime/content-plan-tests', outExtension: { '.js': '.mjs' },
  bundle: true, platform: 'node', format: 'esm', external: ['nodemailer'],
  plugins: [testRuntimePlugin({ auth: true })],
});
const { db, pg } = await createTestDb();
globalThis.testDb = db;
const origin = 'https://tracker.test';
globalThis.testEnv = { AUTH_URL: origin, OWNER_EMAIL: 'contact@the1core.com', OWNER_PASSWORD: 'TOC-owner-test-password' };
const load = (n) => import(pathToFileURL(`${process.cwd()}/.sites-runtime/content-plan-tests/${n}.mjs`));
const [password, records, planRoute, core] = await Promise.all(['password', 'records', 'plan', 'core'].map(load));

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

// No AI: any call out of the process fails the run.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => { if (/^https?:\/\/(?!tracker\.test)/.test(String(url))) throw new Error(`unexpected network call ${url}`); return realFetch(url, init); };

// ---------------------------------------------------------------- 1. pure helpers
eq(core.cleanBranches([{ id: 'a', name: ' Orientation ' }, { id: 'a', name: 'dup' }, { id: '', name: 'x' }, { id: 'b', name: '' }, 'junk', { id: 'c', name: 'Profs' }]), [{ id: 'a', name: 'Orientation' }, { id: 'c', name: 'Profs' }], 'branches cleaned: named, unique');
eq(core.countItems([{ planType: 'reel' }, { planType: 'reel', archived: true }, { planType: 'post' }, { planType: 'story' }]), { reel: 1, post: 1, story: 1 }, 'counts leave out archived nodes');
eq([core.nextMonth('2026-12'), core.isMonth('2026-13'), core.isDay('2026-10-31'), core.isDay('2026-10-3')], ['2027-01', false, true, false], 'months and days');

// ---------------------------------------------------------------- people and helpers
const cookieOf = (r) => r.headers.getSetCookie().find((c) => c.startsWith('__Host-the-one.session='))?.split(';')[0] ?? null;
let ip = 1;
const signIn = async (email, pass) => {
  const r = await password.POST(new Request(origin + '/api/auth/password', { method: 'POST', headers: { 'content-type': 'application/json', origin, 'x-vercel-forwarded-for': `198.51.100.${ip++}` }, body: JSON.stringify({ action: 'sign-in', email, password: pass }) }));
  return cookieOf(r);
};
const getRecords = async (cookie, ws) => (await records.GET(new Request(origin + '/api/records', { headers: { cookie, ...(ws ? { 'X-Workspace-Id': ws } : {}) } }))).json();
const postRecords = async (cookie, ws, body, expected = 200) => {
  const r = await records.POST(new Request(origin + '/api/records', { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json', 'X-Workspace-Id': ws }, body: JSON.stringify(body) }));
  const data = await r.json(); assert.equal(r.status, expected, JSON.stringify(data)); checks++; return data;
};
const api = async (cookie, ws, body, expected = 200) => {
  const r = await planRoute.POST(new Request(origin + '/api/content-plan', { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json', 'X-Workspace-Id': ws }, body: JSON.stringify(body) }));
  const data = await r.json(); assert.equal(r.status, expected, JSON.stringify(data)); checks++; return data;
};
const read = async (cookie, ws, query, expected = 200) => {
  const r = await planRoute.GET(new Request(`${origin}/api/content-plan?${new URLSearchParams(query)}`, { headers: { cookie, 'X-Workspace-Id': ws } }));
  const data = await r.json(); assert.equal(r.status, expected, JSON.stringify(data)); checks++; return data;
};
const passwordChange = async (email, temp) => {
  const first = await signIn(email, temp);
  await password.POST(new Request(origin + '/api/auth/password', { method: 'POST', headers: { 'content-type': 'application/json', origin, cookie: first }, body: JSON.stringify({ action: 'change-password', currentPassword: temp, newPassword: `${email}-password` }) }));
  return signIn(email, `${email}-password`);
};

const owner = await signIn('contact@the1core.com', 'TOC-owner-test-password');
const studio = await getRecords(owner);
const WS = studio.workspace.id;
const client = await postRecords(owner, WS, { action: 'create', kind: 'client', data: { name: 'Centre Alkhaouarizmi', city: 'Tanger' } });
const CID = client.id;

// ---------------------------------------------------------------- 2. a month by hand
eq(await read(owner, WS, { clientId: CID }), { plans: [], canEdit: true }, 'no plan yet');
await api(owner, WS, { action: 'create', clientId: CID, month: '2026-13' }, 400);
await api(owner, WS, { action: 'create', clientId: 'nope', month: '2026-10' }, 404);
let plan = (await api(owner, WS, { action: 'create', clientId: CID, month: '2026-10', copyBranches: true })).plan;
eq([plan.month, plan.branches, plan.notes, plan.shared, plan.archived], ['2026-10', [], '', false, false], 'an empty October (nothing to copy from)');
await api(owner, WS, { action: 'create', clientId: CID, month: '2026-10' }, 409);

plan = (await api(owner, WS, { action: 'update-plan', planId: plan.id, revision: plan.revision, patch: { branches: [{ id: 'orient', name: 'الخوارزمي يوجه' }, { id: 'prof', name: 'Prof 1 min' }, { id: 'eleve', name: 'Élève du mois' }], notes: 'Rentrée : on pose l’orientation.' } })).plan;
eq([plan.branches.map((b) => b.name), plan.notes], [['الخوارزمي يوجه', 'Prof 1 min', 'Élève du mois'], 'Rentrée : on pose l’orientation.'], 'branches and notes saved');
await api(owner, WS, { action: 'update-plan', planId: plan.id, revision: plan.revision - 1, patch: { notes: 'x' } }, 409);

const add = (planBranch, planType, name, extra = {}) => api(owner, WS, { action: 'add-item', planId: plan.id, planBranch, planType, name, ...extra });
const r1 = (await add('orient', 'reel', 'BTS ou DUT ?', { due: '2026-10-01' })).item;
await add('orient', 'reel', 'ENSA ou ENCG ?');
await add('prof', 'reel', 'Maths : le 2nd degré');
const p1 = (await add('eleve', 'post', 'Portrait de Salma')).item;
await add('eleve', 'story', 'Élève de la semaine');
await api(owner, WS, { action: 'add-item', planId: plan.id, planBranch: 'nope', planType: 'reel', name: 'x' }, 404);
await api(owner, WS, { action: 'add-item', planId: plan.id, planBranch: 'orient', planType: 'tiktok', name: 'x' }, 400);
await api(owner, WS, { action: 'add-item', planId: plan.id, planBranch: 'orient', planType: 'reel', name: '  ' }, 400);
await api(owner, WS, { action: 'add-item', planId: plan.id, planBranch: 'orient', planType: 'reel', name: 'x', due: '2026-10-99' }, 400);
eq([r1.kind, r1.status, r1.clientId, r1.due, r1.planBranch, r1.planType, r1.planShared], ['task', 'À faire', CID, '2026-10-01', 'orient', 'reel', false], 'a node is a real task');
ok(!('due' in p1), 'a node needs no date');
let detail = await read(owner, WS, { planId: plan.id });
eq(detail.items.map((i) => i.name)[0], 'BTS ou DUT ?', 'dated nodes first');
eq(core.countItems(detail.items), { reel: 3, post: 1, story: 1 }, '3 reels, 1 post, 1 story');
eq((await read(owner, WS, { clientId: CID })).plans[0], { id: plan.id, month: '2026-10', shared: false, archived: false, branches: 3, items: 5 }, 'the month list counts branches and nodes');
eq((await getRecords(owner, WS)).records.filter((r) => r.kind === 'task' && r.planId === plan.id).length, 5, 'the nodes show in the studio’s tasks');

// ---------------------------------------------------------------- 3. editing a node
const moved = (await api(owner, WS, { action: 'update-item', itemId: p1.id, revision: p1.revision, patch: { planBranch: 'orient' } })).item;
eq(moved.planBranch, 'orient', 'dragged onto another branch');
await api(owner, WS, { action: 'update-item', itemId: p1.id, revision: p1.revision, patch: { name: 'x' } }, 409);
await api(owner, WS, { action: 'update-item', itemId: p1.id, revision: moved.revision, patch: { planBranch: 'ghost' } }, 404);
const edited = (await api(owner, WS, { action: 'update-item', itemId: p1.id, revision: moved.revision, patch: {
  name: 'Portrait de Salma, élève du mois', planType: 'reel', due: '2026-10-30', status: 'En cours', assigneeId: studio.user.id,
  planContent: 'Son parcours, ses progrès, le mot de ses parents.', deliverable: 'https://drive.google.com/file/d/abc/view', planBranch: 'eleve',
} })).item;
eq([edited.name, edited.planType, edited.due, edited.status, edited.assigneeId, edited.description, edited.planBranch], ['Portrait de Salma, élève du mois', 'reel', '2026-10-30', 'En cours', studio.user.id, 'Son parcours, ses progrès, le mot de ses parents.', 'eleve'], 'title, type, date, status, assignee, idea and branch saved');
await api(owner, WS, { action: 'update-item', itemId: p1.id, revision: edited.revision, patch: { deliverable: 'javascript:alert(1)' } }, 400);
await api(owner, WS, { action: 'update-item', itemId: p1.id, revision: edited.revision, patch: { status: 'Perdu' } }, 400);
await api(owner, WS, { action: 'update-item', itemId: p1.id, revision: edited.revision, patch: { name: '' } }, 400);
const undated = (await api(owner, WS, { action: 'update-item', itemId: p1.id, revision: edited.revision, patch: { due: '' } })).item;
ok(!('due' in undated), 'the date can be cleared');

// ---------------------------------------------------------------- 4. archiving a node, removing a branch (never deleting)
const story = detail.items.find((i) => i.planType === 'story');
await api(owner, WS, { action: 'update-item', itemId: story.id, revision: story.revision, patch: { archived: true } });
detail = await read(owner, WS, { planId: plan.id });
eq(detail.items.length, 4, 'an archived node leaves the map');
eq((await db.query("SELECT data->>'archived' AS a FROM records WHERE id = $1", [story.id]))[0].a, 'true', 'still stored, archived');
plan = detail.plan;
await api(owner, WS, { action: 'update-plan', planId: plan.id, revision: plan.revision, patch: { branches: plan.branches.filter((b) => b.id !== 'prof') } }, 409);
eq((await api(owner, WS, { action: 'remove-branch', planId: plan.id, branchId: 'prof' })).archived, 1, 'removing a branch removes its node');
detail = await read(owner, WS, { planId: plan.id });
eq([detail.plan.branches.map((b) => b.id), detail.items.length], [['orient', 'eleve'], 3], 'branch gone, its node too');
const rows = await db.query("SELECT count(*)::int AS n FROM records WHERE kind = 'task' AND data->>'planId' = $1", [plan.id]);
eq(rows[0].n, 4, 'the removed branch’s node is deleted, the archived one kept');
plan = (await api(owner, WS, { action: 'update-plan', planId: detail.plan.id, revision: detail.plan.revision, patch: { branches: [...detail.plan.branches, { id: 'coulisses', name: 'Coulisses' }] } })).plan;
plan = (await api(owner, WS, { action: 'update-plan', planId: plan.id, revision: plan.revision, patch: { branches: plan.branches.map((b) => (b.id === 'coulisses' ? { ...b, name: 'Coulisses du centre' } : b)) } })).plan;
eq(plan.branches.at(-1), { id: 'coulisses', name: 'Coulisses du centre' }, 'a branch added then renamed');

// ---------------------------------------------------------------- 5. the client: hidden until shared, then read-only with comments
const invite = await postRecords(owner, WS, { action: 'invite-member', email: 'parent@alkhaouarizmi.test', name: 'Direction du centre', role: 'client', clientId: CID });
const contact = await passwordChange('parent@alkhaouarizmi.test', invite.invitation.temporaryPassword);
let portal = await getRecords(contact);
eq(portal.records.filter((r) => r.planId).length, 0, 'plan nodes hidden from the portal before sharing');
eq((await read(contact, WS, {})).plans, [], 'no shared plan yet');
await read(contact, WS, { planId: plan.id }, 404);
await api(contact, WS, { action: 'share', planId: plan.id }, 403);
await api(contact, WS, { action: 'add-item', planId: plan.id, planBranch: 'orient', planType: 'reel', name: 'x' }, 403);
await api(owner, WS, { action: 'share', planId: plan.id });
portal = await getRecords(contact);
eq(portal.records.filter((r) => r.planId === plan.id).length, 3, 'shared: the client sees the live nodes');
const shared = await read(contact, WS, {});
eq(shared.plans.map((p) => [p.month, p.items]), [['2026-10', 3]], 'the client lists the shared month');
const seen = await read(contact, WS, { planId: plan.id });
eq(Object.keys(seen.plan).sort(), ['branches', 'clientId', 'id', 'month', 'notes', 'shared'], 'the client gets the map, nothing internal');
ok(seen.items.every((i) => !('assigneeId' in i) && !('deliverable' in i) && !('history' in i)), 'nodes without assignee, Drive link or history');
await postRecords(contact, WS, { action: 'comment', taskId: r1.id, text: 'On préfère tourner avec le directeur.' });
eq((await read(owner, WS, { planId: plan.id })).comments.filter((c) => c.taskId === r1.id).length, 1, 'the client’s comment counts on the node');
const late = (await add('orient', 'post', 'Calendrier des concours')).item;
eq(late.planShared, true, 'a node added to a shared plan is shared too');
await api(owner, WS, { action: 'unshare', planId: plan.id });
eq((await getRecords(contact)).records.filter((r) => r.planId).length, 0, 'unshared: hidden again');

// ---------------------------------------------------------------- 6. duplicate, new month from last month, archive
const dup = await api(owner, WS, { action: 'duplicate', planId: plan.id });
detail = await read(owner, WS, { planId: dup.plan.id });
eq([dup.plan.month, detail.plan.branches.map((b) => b.id), detail.items.length], ['2026-11', ['orient', 'eleve', 'coulisses'], 4], 'November: same branches, same live nodes');
ok(detail.items.every((i) => i.status === 'À faire' && !i.due && !i.assigneeId), 'copies start undated, unassigned, « À faire »');
await api(owner, WS, { action: 'duplicate', planId: plan.id }, 409);
const dec = (await api(owner, WS, { action: 'create', clientId: CID, month: '2026-12', copyBranches: true })).plan;
eq(dec.branches.map((b) => b.id), ['orient', 'eleve', 'coulisses'], 'a new month can start from the latest branches');
eq((await api(owner, WS, { action: 'create', clientId: CID, month: '2027-01' })).plan.branches, [], 'or empty');
await api(owner, WS, { action: 'archive', planId: plan.id });
detail = await read(owner, WS, { planId: plan.id });
ok(detail.plan.archived && detail.items.length === 4 && detail.items.every((i) => i.archived), 'archived month: its nodes archived with it');
await api(owner, WS, { action: 'add-item', planId: plan.id, planBranch: 'orient', planType: 'reel', name: 'x' }, 404);
const again = (await api(owner, WS, { action: 'create', clientId: CID, month: '2026-10' })).plan;
await api(owner, WS, { action: 'unarchive', planId: plan.id }, 409);
await api(owner, WS, { action: 'archive', planId: again.id });
await api(owner, WS, { action: 'unarchive', planId: plan.id });
detail = await read(owner, WS, { planId: plan.id });
eq(detail.items.filter((i) => !i.archived).length, 4, 'unarchived: the same nodes come back (not the ones archived before)');

// ---------------------------------------------------------------- 7. roles
const creative = await postRecords(owner, WS, { action: 'invite-member', email: 'crea@studio.test', name: 'Yassine', role: 'creative' });
const crea = await passwordChange('crea@studio.test', creative.invitation.temporaryPassword);
ok((await read(crea, WS, { clientId: CID })).canEdit === false, 'a member reads, cannot edit');
ok((await read(crea, WS, { planId: plan.id })).items.length === 4, 'a member reads a month');
await api(crea, WS, { action: 'add-item', planId: plan.id, planBranch: 'orient', planType: 'reel', name: 'x' }, 403);
const social = await postRecords(owner, WS, { action: 'invite-member', email: 'sm@studio.test', name: 'Nora', role: 'social' });
const sm = await passwordChange('sm@studio.test', social.invitation.temporaryPassword);
eq((await api(sm, WS, { action: 'add-item', planId: plan.id, planBranch: 'orient', planType: 'story', name: 'Sondage' })).item.planType, 'story', 'a social media manager edits');
const anon = await planRoute.GET(new Request(`${origin}/api/content-plan?clientId=${CID}`, { headers: { 'X-Workspace-Id': WS } }));
eq(anon.status, 401, 'signed out: refused');

// ---------------------------------------------------------------- 8. a ready plan uploaded as JSON
const model = JSON.parse(readFileSync('public/plan-editorial-modele.json', 'utf8'));
const parsed = core.parsePlanFile(model);
ok('plan' in parsed, 'the public template is valid');
const all = parsed.plan.branches.flatMap((b) => b.items);
eq([core.countItems(all), parsed.plan.month], [{ reel: 12, post: 12, story: 3 }, '2026-10'], 'template: 12 reels, 12 posts, 3 stories in October');
const bad = core.parsePlanFile({ month: '2026-1', branches: [{ name: '', items: [{ type: 'tiktok', title: '', date: '31/10', status: 'Fini', drive: 'ftp://x' }] }] });
eq(bad.errors.length, 7, 'every problem listed');
ok(bad.errors.some((e) => e.startsWith('Branche 1, contenu 1 : « type »')), 'each problem says where it is');
eq(core.parsePlanFile([]).errors, ['Le fichier doit contenir un objet JSON avec « branches ».'], 'not an object');
eq(core.parsePlanFile({ branches: [{ name: 'A', items: [{ type: 'Carrousel', name: 'x', content: 'y' }] }] }).plan.branches[0].items[0], { name: 'x', planType: 'post', planContent: 'y' }, 'aliases: carrousel → post, name / content');
const client2 = await postRecords(owner, WS, { action: 'create', kind: 'client', data: { name: 'Client JSON' } });
const refused = await api(owner, WS, { action: 'import', clientId: client2.id, file: { branches: [{ name: 'A', items: [{ type: 'x', title: 'y' }] }] } }, 400);
ok(refused.problems.length === 1 && /reel, post ou story/.test(refused.problems[0]), 'a bad file: refused with its problems');
await api(owner, WS, { action: 'import', clientId: client2.id, file: { branches: [{ name: 'A', items: [] }] } }, 400);
await api(crea, WS, { action: 'import', clientId: client2.id, file: model }, 403);
const imported = await api(owner, WS, { action: 'import', clientId: client2.id, file: model });
eq([imported.count, imported.plan.month, imported.plan.branches.length], [27, '2026-10', 7], 'imported: a new October with 7 branches and 27 contents');
detail = await read(owner, WS, { planId: imported.plan.id });
eq(core.countItems(detail.items), { reel: 12, post: 12, story: 3 }, '12 reels, 12 posts, 3 stories on the map');
ok(detail.items.every((i) => i.kind === 'task' && i.status === 'À faire' && i.due?.startsWith('2026-10-') && i.planContent), 'real tasks, dated in October, with their idea');
ok(detail.plan.notes.startsWith('Octobre'), 'notes imported');
await api(owner, WS, { action: 'import', clientId: client2.id, file: model }, 409);
const more = await api(owner, WS, { action: 'import', clientId: client2.id, planId: imported.plan.id, file: { branches: [{ name: 'élève du mois', items: [{ type: 'story', title: 'Bravo Salma', status: 'En cours', drive: 'https://drive.google.com/file/d/x/view' }] }, { name: 'Nouveautés', items: [{ type: 'reel', title: 'Nouvelle salle' }] }] } });
detail = await read(owner, WS, { planId: imported.plan.id });
eq([more.count, detail.plan.branches.length, detail.items.length], [2, 8, 29], 'imported into the open month: same-name branch reused, a new one added');
const bravo = detail.items.find((i) => i.name === 'Bravo Salma');
eq([bravo.planBranch, bravo.status, bravo.deliverable], [detail.plan.branches.find((b) => b.name === 'Élève du mois').id, 'En cours', 'https://drive.google.com/file/d/x/view'], 'branch matched by name, status and Drive link kept');
await api(owner, WS, { action: 'import', clientId: CID, planId: imported.plan.id, file: model }, 404);

// ---------------------------------------------------------------- 9. editing a month as JSON, deleting
detail = await read(owner, WS, { planId: imported.plan.id });
const asFile = core.planToFile(detail.plan, detail.items);
eq([asFile.month, asFile.branches.length, asFile.branches.flatMap((b) => b.items).length], ['2026-10', 8, 29], 'the month exported with its 8 branches and 29 contents');
ok(asFile.branches.every((b) => b.id) && asFile.branches.flatMap((b) => b.items).every((i) => i.id && i.type && i.title && i.status), 'with the ids');
const salma = detail.items.find((i) => i.name === 'Bravo Salma');
await postRecords(owner, WS, { action: 'comment', taskId: salma.id, text: 'Photo validée par les parents.' });
const edit = structuredClone(asFile);
edit.notes = 'Notes réécrites.';
edit.branches[0].name = 'Orientation (reels)';
const first = edit.branches[0].items[0];
first.title = 'BTS ou DUT : le vrai choix'; first.status = 'À valider'; first.date = '2026-10-02';
edit.branches[0].items.push({ type: 'post', title: 'Nouveau carrousel', date: '2026-10-28' });
const dropped = edit.branches[1].items.splice(0, 2).map((i) => i.id);
const elv = edit.branches.find((b) => b.name === 'Élève du mois');
edit.branches.push(edit.branches.splice(edit.branches.indexOf(elv), 1)[0]);
const replaced = await api(owner, WS, { action: 'replace', planId: imported.plan.id, file: edit });
eq([replaced.created, replaced.updated, replaced.deleted], [1, 1, 2], '1 added, 1 changed, 2 deleted');
detail = await read(owner, WS, { planId: imported.plan.id });
eq([detail.plan.notes, detail.plan.branches[0].name, detail.plan.branches.at(-1).name, detail.items.length], ['Notes réécrites.', 'Orientation (reels)', 'Élève du mois', 28], 'notes, renamed branch, new order, 28 contents');
const firstNow = detail.items.find((i) => i.id === first.id);
eq([firstNow.name, firstNow.status, firstNow.due, firstNow.planBranch], ['BTS ou DUT : le vrai choix', 'À valider', '2026-10-02', asFile.branches[0].id], 'edited in place: same task, same branch id');
eq((await read(owner, WS, { planId: imported.plan.id })).comments.filter((c) => c.taskId === salma.id).length, 1, 'a content kept by id keeps its comments');
eq((await db.query("SELECT count(*)::int AS n FROM records WHERE id = ANY($1::text[])", [dropped]))[0].n, 0, 'contents left out of the JSON are deleted');
eq((await api(owner, WS, { action: 'replace', planId: imported.plan.id, file: core.planToFile(detail.plan, detail.items) })).updated, 0, 'saving it unchanged changes nothing');
await api(owner, WS, { action: 'replace', planId: imported.plan.id, file: { ...edit, month: '2026-11' } }, 400);
await api(owner, WS, { action: 'replace', planId: imported.plan.id, file: { branches: [{ name: 'A', items: [{ type: 'x', title: 'y' }] }] } }, 400);
await api(crea, WS, { action: 'replace', planId: imported.plan.id, file: edit }, 403);
await api(crea, WS, { action: 'delete-item', itemId: salma.id }, 403);
await api(owner, WS, { action: 'delete-item', itemId: salma.id });
eq((await db.query("SELECT count(*)::int AS n FROM records WHERE id = $1 OR (kind = 'comment' AND data->>'taskId' = $1)", [salma.id]))[0].n, 0, 'a deleted content takes its comments with it');
await api(owner, WS, { action: 'delete-item', itemId: salma.id }, 404);
await api(crea, WS, { action: 'delete-plan', planId: imported.plan.id }, 403);
await api(owner, WS, { action: 'delete-plan', planId: imported.plan.id });
eq((await db.query("SELECT count(*)::int AS n FROM records WHERE data->>'planId' = $1 OR id LIKE $2", [imported.plan.id, `%${imported.plan.id}`]))[0].n, 0, 'a deleted month: the plan and all its contents gone');
eq((await read(owner, WS, { clientId: client2.id })).plans, [], 'the month list is empty again');
ok((await api(owner, WS, { action: 'import', clientId: client2.id, file: model })).count === 27, 'the month can be imported again');

globalThis.fetch = realFetch;
await pg.close();
console.log(`${checks} Plan Éditorial checks passed: branches, nodes as real tasks, moving between branches, dates, status, assignee, ideas, archiving, removing a branch, sharing with the client (hidden until then, read-only, comments), duplication, starting from last month's branches, roles, importing a ready plan from JSON (the public template: 12 reels, 12 posts, 3 stories), editing a month as JSON (kept by id, the rest deleted), deleting a content or a month — no AI.`);
