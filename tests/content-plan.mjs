// Plan Éditorial (lib/content-plan*.ts, /api/content-plan): a month built by hand as a mind map —
// branches, and on each one reels, posts and stories that are real tasks. Creating a month (empty, or
// with last month's branches), branches added and renamed, nodes added, moved to another branch, dated,
// assigned and archived (never deleted), a branch removed with its nodes archived, sharing with the
// client (hidden from the portal until then, read-only, comments through the task thread), duplication,
// archiving a month, and who may do what. No AI anywhere.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
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
eq((await api(owner, WS, { action: 'remove-branch', planId: plan.id, branchId: 'prof' })).archived, 1, 'removing a branch archives its node');
detail = await read(owner, WS, { planId: plan.id });
eq([detail.plan.branches.map((b) => b.id), detail.items.length], [['orient', 'eleve'], 3], 'branch gone, its node archived');
const rows = await db.query("SELECT count(*)::int AS n FROM records WHERE kind = 'task' AND data->>'planId' = $1", [plan.id]);
eq(rows[0].n, 5, 'nothing was deleted');
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

globalThis.fetch = realFetch;
await pg.close();
console.log(`${checks} Plan Éditorial checks passed: branches, nodes as real tasks, moving between branches, dates, status, assignee, ideas, archiving without deleting, removing a branch, sharing with the client (hidden until then, read-only, comments), duplication, starting from last month's branches, roles — no AI.`);
