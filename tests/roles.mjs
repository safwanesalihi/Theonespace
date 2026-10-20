// Role boundaries: one owner, members see clients + their own tasks only, clients see their portal only.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';

const esbuildPath = globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0] || 'node_modules/esbuild/lib/main.js';
const esbuild = await import(pathToFileURL(esbuildPath));
mkdirSync('.sites-runtime', { recursive: true });
await esbuild.build({ entryPoints: ['app/api/records/route.ts'], outfile: '.sites-runtime/roles-test.mjs', bundle: true, platform: 'node', format: 'esm', plugins: [testRuntimePlugin({ auth: false })] });
const { db, pg } = await createTestDb();
globalThis.testDb = db;
globalThis.testEnv = { OWNER_EMAIL: 'owner@studio.test' };
const owner = { userId: 'owner', fullName: 'Safwane Owner', displayName: 'Safwane Owner', email: 'owner@studio.test' };
const yasmine = { userId: '', fullName: 'Yasmine Creative', displayName: 'Yasmine Creative', email: 'yasmine@studio.test' };
const amine = { userId: '', fullName: 'Amine Creative', displayName: 'Amine Creative', email: 'amine@studio.test' };
const contact = { userId: '', fullName: 'Client Contact', displayName: 'Client Contact', email: 'contact@client.test' };
const { GET, POST } = await import(pathToFileURL(process.cwd() + '/.sites-runtime/roles-test.mjs'));
await esbuild.build({ entryPoints: ['lib/flow.ts'], outfile: '.sites-runtime/roles-flow.mjs', bundle: true, platform: 'node', format: 'esm' });
const { portalView } = await import(pathToFileURL(process.cwd() + '/.sites-runtime/roles-flow.mjs'));

let checks = 0;
const WS = 'ws:owner';
const as = (user) => { globalThis.testUser = user; };
async function post(body, status = 200) { return postTo(WS, body, status); }
async function postTo(workspaceId, body, status = 200) {
  const r = await POST(new Request('https://tracker.test/api/records', { method: 'POST', headers: { 'Content-Type': 'application/json', origin: 'https://tracker.test', 'X-Workspace-Id': workspaceId }, body: JSON.stringify(body) }));
  const d = await r.json(); assert.equal(r.status, status, JSON.stringify(d)); checks++; return d;
}
async function get(status = 200, workspaceId = WS) {
  const r = await GET(new Request('https://tracker.test/api/records', { headers: workspaceId ? { 'X-Workspace-Id': workspaceId } : {} }));
  const d = await r.json(); assert.equal(r.status, status, JSON.stringify(d)); checks++; return d;
}
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const ids = (d, kind) => d.records.filter((r) => r.kind === kind).map((r) => r.id).sort();

// Owner sets up two clients, projects, and tasks for two members.
as(owner);
await get(200, null);
const brandBrief = JSON.parse(readFileSync('public/brief-marque-modele.json', 'utf8'));
const c1 = await post({ action: 'create', kind: 'client', data: { name: 'Client Un', brief: brandBrief } });
const c2 = await post({ action: 'create', kind: 'client', data: { name: 'Client Deux' } });
const p1 = await post({ action: 'create', kind: 'project', data: { name: 'Projet Un', clientId: c1.id } });
const p2 = await post({ action: 'create', kind: 'project', data: { name: 'Projet Deux', clientId: c2.id } });
const idOf = (d, email) => d.members.find((m) => m.email === email).userId;
yasmine.userId = idOf(await post({ action: 'invite-member', email: 'yasmine@studio.test', name: 'Yasmine Creative', role: 'creative' }), 'yasmine@studio.test');
amine.userId = idOf(await post({ action: 'invite-member', email: 'amine@studio.test', name: 'Amine Creative', role: 'creative' }), 'amine@studio.test');
contact.userId = idOf(await post({ action: 'invite-member', email: 'contact@client.test', name: 'Client Contact', role: 'client', clientId: c1.id }), 'contact@client.test');
await post({ action: 'invite-member', email: 'x@y.test', role: 'owner' }, 400);
await post({ action: 'invite-member', email: 'owner@studio.test', role: 'creative' }, 400);
as(owner);
const t = (name, clientId, projectId, assignee, extra = {}) => post({ action: 'create', kind: 'task', data: { name, clientId, projectId, assignee, status: 'En cours', due: '2026-12-01', ...extra } });
const ty1 = await t('Reel Yasmine', c1.id, p1.id, 'Yasmine Creative', { deliverable: 'https://x.test/y1.mp4' });
const ty2 = await t('Post Yasmine', c2.id, p2.id, 'Yasmine Creative');
const ta1 = await t('Affiche Amine', c1.id, p1.id, 'Amine Creative', { deliverable: 'https://x.test/a1.pdf' });
const tu = await t('Non assignée', c1.id, p1.id, '');
await post({ action: 'comment', taskId: ta1.id, text: 'Note du propriétaire sur la tâche d’Amine.' });

// Only one owner: nobody can be set to owner, the owner cannot be changed.
await post({ action: 'set-member-role', userId: yasmine.userId, expectedRole: 'creative', role: 'owner' }, 400);
await post({ action: 'set-member-role', userId: owner.userId, expectedRole: 'owner', role: 'admin' }, 400);
const ownerView = await get();
eq(ownerView.members.filter((m) => m.role === 'owner').length, 1, 'exactly one owner');

// A member sees every client and project but only their own tasks, comments and events.
as(yasmine);
const y = await get();
eq(y.workspace.role, 'creative');
eq(ids(y, 'client'), [c1.id, c2.id].sort(), 'all clients visible');
eq(ids(y, 'project'), [p1.id, p2.id].sort(), 'all projects visible');
eq(ids(y, 'task'), [ty1.id, ty2.id, tu.id].sort(), 'tasks assigned to Yasmine plus the unassigned one');
eq(ids(y, 'comment'), [], 'no comments from other people’s tasks');
ok(y.members.every((m) => m.email === null || m.userId === yasmine.userId) && !y.members.some((m) => m.inviteCode), 'roster without e-mails or codes');
ok(!y.members.some((m) => m.userId.startsWith('invite:')), 'pending invitations hidden');

// The posting calendar (editorial_post) and the platform list are visible to every studio role,
// same as the shared library — this is the regression test for memberView()'s fix.
eq(ids(y, 'platform').length, 3, 'a member sees the default platform list');
as(owner);
const post1 = await post({ action: 'create', kind: 'editorial_post', data: { name: 'Carrousel de rentrée', clientId: c1.id, due: '2026-12-10' } });
as(yasmine);
ok(ids(await get(), 'editorial_post').includes(post1.id), 'a member sees every client’s editorial posts, not just their own tasks');

// A member may only act on their own tasks, and always for themselves.
await post({ action: 'update', kind: 'task', id: ta1.id, revision: 1, data: { name: 'Affiche Amine', clientId: c1.id, projectId: p1.id, assignee: 'Amine Creative', status: 'En cours', due: '2026-12-01' } }, 404);
await post({ action: 'comment', taskId: ta1.id, text: 'intrusion' }, 404);
await post({ action: 'comment', taskId: tu.id, text: 'je prends' });
// A member's only edit on a task is the deliverable link — no reassigning or handing off to a teammate.
await post({ action: 'update', kind: 'task', id: ty2.id, revision: 1, data: { name: 'Post Yasmine', clientId: c2.id, projectId: p2.id, assignee: 'Amine Creative', status: 'En cours', due: '2026-12-01' } }, 403);
ok((await get()).records.some((r) => r.id === ty2.id), 'the task stays with Yasmine after the rejected hand-off');
await post({ action: 'create', kind: 'task', data: { name: 'Story créée par Yasmine', clientId: c1.id, projectId: p1.id, assignee: 'Yasmine Creative', status: 'À faire', due: '2026-12-05' } }, 403);
as(owner);
const mine = await t('Story pour Yasmine', c1.id, p1.id, 'Yasmine Creative');
as(yasmine);
ok((await get()).records.some((r) => r.id === mine.id), 'tasks are created by the owner and assigned to members');
// A member can also send their own task back to "À faire" (not just "À valider") — e.g. to un-claim work started by mistake.
const backToTodo = await post({ action: 'update', kind: 'task', id: mine.id, revision: 1, data: { name: 'Story pour Yasmine', clientId: c1.id, projectId: p1.id, assignee: 'Yasmine Creative', status: 'À faire', due: '2026-12-01' } });
eq(backToTodo.records.find((r) => r.id === mine.id).status, 'À faire', 'a member can move their own task back to "À faire"');

// "En pause": a member pauses their own work, and pausing stops EVERY clock on the task — including
// ones started by someone other than the person who clicked pause.
const toWork = await post({ action: 'update', kind: 'task', id: mine.id, revision: 2, data: { name: 'Story pour Yasmine', clientId: c1.id, projectId: p1.id, assignee: 'Yasmine Creative', status: 'En cours', due: '2026-12-01' } });
await post({ action: 'start-timer', taskId: mine.id });
as(owner);
await post({ action: 'start-timer', taskId: mine.id });
const twoClocks = (await get()).records.find((r) => r.id === mine.id);
eq(twoClocks.timeEntries.filter((e) => !e.end).length, 2, 'two people are timing the same task');
as(yasmine);
const paused = await post({ action: 'update', kind: 'task', id: mine.id, revision: twoClocks.revision, data: { name: 'Story pour Yasmine', clientId: c1.id, projectId: p1.id, assignee: 'Yasmine Creative', status: 'En pause', due: '2026-12-01' } });
const pausedTask = paused.records.find((r) => r.id === mine.id);
eq(pausedTask.status, 'En pause', 'a member can pause their own task');
eq(pausedTask.timeEntries.filter((e) => !e.end).length, 0, 'pausing stops every running clock, not only the pauser’s');
eq(pausedTask.timeEntries.length, 2, 'the time already spent is kept');
const resumed = await post({ action: 'update', kind: 'task', id: mine.id, revision: pausedTask.revision, data: { name: 'Story pour Yasmine', clientId: c1.id, projectId: p1.id, assignee: 'Yasmine Creative', status: 'En cours', due: '2026-12-01' } });
eq(resumed.records.find((r) => r.id === mine.id).status, 'En cours', 'a paused task resumes');
void toWork;

// Every way out of « En cours » stops every clock — sending for validation here, as the owner, while
// Yasmine's clock is running too. And no clock starts on a task that isn't « En cours ».
await post({ action: 'start-timer', taskId: mine.id });
as(owner);
await post({ action: 'start-timer', taskId: mine.id });
const twoRunning = (await get()).records.find((r) => r.id === mine.id);
eq(twoRunning.timeEntries.filter((e) => !e.end).length, 2, 'two clocks running again');
const sentForReview = await post({ action: 'update', kind: 'task', id: mine.id, revision: twoRunning.revision, data: { name: 'Story pour Yasmine', clientId: c1.id, projectId: p1.id, assignee: 'Yasmine Creative', status: 'À valider', due: '2026-12-01', deliverable: 'https://x.test/story.mp4' } });
const sentTask = sentForReview.records.find((r) => r.id === mine.id);
eq(sentTask.timeEntries.filter((e) => !e.end).length, 0, 'sending for validation stops everyone’s clock');
ok(sentTask.timeEntries.every((e) => e.end >= e.start), 'each clock ends after it started');
await post({ action: 'start-timer', taskId: mine.id }, 409);
// Clocks left running before this rule are closed when the workspace loads, at the moment the task
// left work (here: its validation), never later.
const legacy = { ...sentTask, status: 'Validé', validatedAt: '2026-01-10T10:00:00.000Z', sentAt: '2026-01-09T10:00:00.000Z',
  timeEntries: [...sentTask.timeEntries, { userId: yasmine.userId, name: 'Yasmine Creative', start: '2026-01-09T08:00:00.000Z' }] };
await db.query('UPDATE records SET data = $1::jsonb WHERE id = $2', [JSON.stringify(legacy), mine.id]);
const repaired = (await get()).records.find((r) => r.id === mine.id);
eq(repaired.timeEntries.filter((e) => !e.end).length, 0, 'a clock left running on a validated task is closed on load');
eq(repaired.timeEntries.at(-1).end, '2026-01-09T10:00:00.000Z', 'at the moment the task left work (sent for validation), not now');
await db.query('UPDATE records SET data = $1::jsonb WHERE id = $2', [JSON.stringify({ ...repaired, status: 'En cours', validatedAt: undefined, sentAt: undefined }), mine.id]);
as(yasmine);
await post({ action: 'create', kind: 'client', data: { name: 'Client créé par un membre', quota: '4' } }, 403);
as(owner);
const newClient = await post({ action: 'create', kind: 'client', data: { name: 'Client créé par le propriétaire', quota: '4' } });
as(yasmine);
const newProject = await post({ action: 'create', kind: 'project', data: { name: 'Sous-projet créé par un membre', clientId: newClient.id } });
ok(newProject.records.some((r) => r.id === newProject.id), 'members can still create sub-projects for existing clients');
await post({ action: 'update', kind: 'client', id: newClient.id, revision: 1, data: { name: 'Client créé par un membre', archived: true } }, 403);
// A client's own page (brief, contacts, logo/banner) is studio-owned: a member cannot edit it at all, even without touching archived.
await post({ action: 'update', kind: 'client', id: newClient.id, revision: 1, data: { name: 'Client renommé par un membre' } }, 403);
await post({ action: 'invite-member', email: 'z@z.test', role: 'creative' }, 403);
await post({ action: 'request', clientId: c1.id, data: { name: 'Demande' } }, 403);
// Saving a new deliverable link is the only edit a member can make, and it alone submits the task — to internal review, not the client.
const sent = await post({ action: 'update', kind: 'task', id: ty1.id, revision: 1, data: { name: 'Reel Yasmine', clientId: c1.id, projectId: p1.id, assignee: 'Yasmine Creative', status: 'En cours', due: '2026-12-01', deliverable: 'https://x.test/y1-final.mp4' } });
eq(sent.records.find((r) => r.id === ty1.id).status, 'Validation interne', 'the deliverable link alone moves the task to "Validation interne"');
ok(!sent.records.find((r) => r.id === ty1.id).approvalDueAt, 'a member’s work never reaches the client without the owner or an admin');
await post({ action: 'comment', taskId: ty1.id, text: 'Envoyé !' });
const awaiting = sent.records.find((r) => r.id === ty1.id);
await post({ action: 'update', kind: 'task', id: ty1.id, revision: awaiting.revision, data: { ...awaiting, status: 'Validé' } }, 403);
await post({ action: 'internal-review', taskId: ty1.id, revision: awaiting.revision, decision: 'send' }, 403);
// The client still reads « En cours » until the owner sends it on; then their clock starts.
as(contact);
eq((await get()).records.find((r) => r.id === ty1.id).status, 'En cours', 'internal review reads « En cours » in the portal');
as(owner);
const reviewed = (await get()).records.find((r) => r.id === ty1.id);
const released = await post({ action: 'internal-review', taskId: ty1.id, revision: reviewed.revision, decision: 'send' });
ok(released.records.find((r) => r.id === ty1.id).approvalDueAt, 'the owner sends it to the client, and the client clock starts');

// Amine sees the mirror image.
as(amine);
const a = await get();
eq(ids(a, 'task'), [ta1.id, tu.id].sort(), 'Amine’s task and the unassigned one; ty2 stayed with Yasmine since the hand-off was rejected');
eq(a.records.filter((r) => r.kind === 'comment').length, 2, 'comments on Amine’s task and on the unassigned task are visible to Amine; Yasmine’s own-task comment is not');

// A member manages the shared library freely, but devis/factures/contrats stay invisible to them.
as(amine);
const lib1 = await post({ action: 'create', kind: 'library', data: { name: 'Prompt accroche Instagram', category: 'prompt', content: 'Écris une accroche…' } });
ok(lib1.records.some((r) => r.id === lib1.id && r.kind === 'library'), 'a member can add a library item and sees it right away');
const libUpdated = await post({ action: 'update', kind: 'library', id: lib1.id, revision: 1, data: { name: 'Prompt accroche Instagram v2', category: 'prompt', content: 'Écris une accroche punchy…' } });
eq(libUpdated.records.find((r) => r.id === lib1.id).name, 'Prompt accroche Instagram v2', 'a member edits the library items they added');
await post({ action: 'delete', kind: 'library', id: lib1.id, revision: 2 });
ok(!(await get()).records.some((r) => r.id === lib1.id), 'the deleted library item is gone for everyone');
const lib2 = await post({ action: 'create', kind: 'library', data: { name: 'Logo pack', category: 'asset', link: 'https://drive.example.test/logo-pack' } });
ok(lib2.records.some((r) => r.id === lib2.id && r.category === 'asset' && r.link), 'a link-based library item (asset/plugin/preset) needs no file upload');

as(owner);
const devis1 = await post({ action: 'create', kind: 'document', data: { docType: 'devis', clientId: c1.id, lineItems: [{ description: 'Pack contenu', quantity: 1, unitPrice: 5000 }], taxRate: 20 } });
const devisNumber = devis1.records.find((r) => r.id === devis1.id).number;
ok(/^DEVIS-\d{4}-0001$/.test(devisNumber), 'the first devis of the year is numbered 0001');
const devis2 = await post({ action: 'create', kind: 'document', data: { docType: 'devis', clientId: c2.id, lineItems: [] } });
ok(devis2.records.find((r) => r.id === devis2.id).number.endsWith('-0002'), 'the second devis this year gets the next number, regardless of client');
const facture1 = await post({ action: 'create', kind: 'document', data: { docType: 'facture', clientId: c1.id, lineItems: [] } });
ok(facture1.records.find((r) => r.id === facture1.id).number.endsWith('-0001'), 'factures have their own sequence, independent of devis');

// Sending a devis locks its line items — but re-saving it unchanged (e.g. archiving it) must still work:
// line items are stored as jsonb, which does not preserve key order, so a naive JSON.stringify
// comparison would wrongly see a round-tripped-but-identical array as "changed".
const devisSent = await post({ action: 'update', kind: 'document', id: devis1.id, revision: 1, data: {
  docType: 'devis', clientId: c1.id, docStatus: 'sent', lineItems: devis1.records.find((r) => r.id === devis1.id).lineItems, taxRate: 20,
} });
eq(devisSent.records.find((r) => r.id === devis1.id).docStatus, 'sent', 'the devis is now sent');
await post({ action: 'update', kind: 'document', id: devis1.id, revision: 2, data: {
  docType: 'devis', clientId: c1.id, docStatus: 'sent', lineItems: [{ description: 'Autre chose', quantity: 1, unitPrice: 1 }], taxRate: 20,
} }, 409); // a real change to the line items is still rejected once sent
const archived = await post({ action: 'update', kind: 'document', id: devis1.id, revision: 2, data: {
  docType: 'devis', clientId: c1.id, docStatus: 'sent', lineItems: devisSent.records.find((r) => r.id === devis1.id).lineItems, taxRate: 20, archived: true,
} });
ok(archived.records.find((r) => r.id === devis1.id).archived, 'archiving a sent devis with its lines unchanged succeeds');
await post({ action: 'delete', kind: 'document', id: devis1.id, revision: 3 }, 409); // sent (even archived) documents are never hard-deleted

as(amine);
ok(!(await get()).records.some((r) => r.kind === 'document'), 'a member never sees that a devis/facture/contrat exists');
await post({ action: 'create', kind: 'document', data: { docType: 'devis', clientId: c1.id, lineItems: [] } }, 403);

// The client sees their portal only: their client, projects and tasks — nobody else’s.
// Their page reads only their slice of the workspace, and gets exactly what the portal filter keeps of the whole.
as(owner);
const whole = await get();
as(contact);
const c = await get();
const byId = (rows) => [...rows].sort((x, y) => x.id.localeCompare(y.id));
eq(byId(c.records), byId(portalView(whole.records, c1.id, contact.userId)), 'the client slice serves the same portal as the whole workspace');
ok(c.records.some((r) => r.kind === 'comment') && c.records.some((r) => r.kind === 'event') && c.records.some((r) => r.kind === 'document'), 'comments, notices and documents come with the slice');
eq(c.workspace.role, 'client');
eq(ids(c, 'client'), [c1.id]);
eq(c.records.find((record) => record.id === c1.id).brief, brandBrief, 'the client reads their own brand brief');
await post({ action: 'update', kind: 'client', id: c1.id, revision: 1, data: { name: 'Client Un', brief: { ...brandBrief, overview: 'Unauthorized edit' } } }, 403);
eq(ids(c, 'project'), [p1.id]);
eq(ids(c, 'task'), [ty1.id, ta1.id, tu.id, mine.id].sort(), 'all of Client Un’s tasks, none of Client Deux’s');
ok(!c.records.some((r) => r.id === newClient.id), 'other clients invisible');
ok(c.records.filter((r) => r.kind === 'task').every((r) => !('assignee' in r)), 'assignees hidden from the client');
eq(c.members, []);
eq(ids(c, 'document'), [devis1.id], 'Client Un receives their sent devis; private draft invoice and other clients’ documents remain hidden');
await post({ action: 'approve', taskId: ty1.id });
await post({ action: 'update', kind: 'task', id: ta1.id, revision: 1, data: { name: 'x', clientId: c1.id, projectId: p1.id } }, 403);

as(owner);
eq(ids(await get(), 'task').length, 5, 'the owner sees everything');
eq(ids(await get(), 'client').length, 3, 'only owner-created clients persist');
as(contact);
const requestToAccept = await post({ action: 'request', clientId: c1.id, data: {
  name: 'Story demandée au studio', description: 'Une frame sur le nouveau produit.', priority: 'Haute', platforms: ['Instagram'],
} });
const requestToDecline = await post({ action: 'request', clientId: c1.id, data: { name: 'Contenu hors forfait' } });
// Every non-owner role is forbidden from adding clients.
for (const role of ['admin', 'viewer', 'client']) {
  await db.query('UPDATE workspace_members SET role = $1, client_id = $2 WHERE workspace_id = $3 AND user_id = $4', [role, role === 'client' ? c1.id : null, WS, amine.userId]);
  as(amine);
  await post({ action: 'create', kind: 'client', data: { name: 'Forbidden client' } }, 403);
  if (role === 'admin') {
    const renamed = await post({ action: 'update', kind: 'client', id: newClient.id, revision: 1, data: { name: 'Client renommé par un admin' } });
    eq(renamed.records.find((r) => r.id === newClient.id).name, 'Client renommé par un admin', 'an admin can edit an existing client’s page');
    ok(!(await get()).records.some((r) => r.kind === 'document'), 'an admin never sees that a devis/facture/contrat exists either');
    await post({ action: 'create', kind: 'document', data: { docType: 'devis', clientId: c1.id, lineItems: [] } }, 403);
    const request = (await get()).records.find(r => r.id === requestToAccept.id);
    eq([request?.clientId, request?.description, request?.priority, request?.platforms, request?.requestStatus],
      [c1.id, 'Une frame sur le nouveau produit.', 'Haute', ['Instagram'], 'new'], 'an admin sees the client request and its complete brief');
    const accepted = await post({ action: 'request-accept', id: requestToAccept.id, data: { name: request.name, projectId: p1.id, assigneeId: yasmine.userId } });
    const task = accepted.records.find(r => r.id === accepted.id);
    eq([task?.kind, task?.clientId, task?.assigneeId, task?.priority], ['task', c1.id, yasmine.userId, 'Haute'], 'an admin can turn a client request into an assigned task');
    const declined = await post({ action: 'request-decline', id: requestToDecline.id, reason: 'Ce contenu est hors forfait.' });
    eq(declined.records.find(r => r.id === requestToDecline.id)?.decision?.by, amine.fullName, 'the admin’s name accompanies their request decision');
    as(contact);
    const clientView = await get();
    eq(clientView.records.find(r => r.id === requestToAccept.id)?.requestStatus, 'accepted', 'the client sees the admin’s acceptance');
    eq(clientView.records.find(r => r.id === requestToDecline.id)?.decision?.reason, 'Ce contenu est hors forfait.', 'the client sees the admin’s refusal reason');
    as(amine);
  }
  if (role !== 'admin') await post({ action: 'request-decline', id: requestToDecline.id, reason: 'Interdit' }, 403);
  if (role === 'viewer') {
    const viewerView = await get();
    ok(viewerView.records.some((r) => r.kind === 'library'), 'a viewer still reads the library');
    ok(!viewerView.records.some((r) => r.kind === 'document'), 'a viewer never sees devis/factures/contrats either');
    await post({ action: 'create', kind: 'library', data: { name: 'x', category: 'prompt', content: 'y' } }, 403);
    await post({ action: 'library-favorite', id: lib2.id, on: true }, 403); // read-only: no star (using an entry is only a counter)
  }
}
as(owner);
eq(ids(await get(), 'client').length, 3, 'denied creations persist no clients');
// Anyone can rename their own profile; the roster and greeting data follow, e-mail stays.
as(yasmine);
await post({ action: 'update-profile', name: ' ' }, 400);
const renamed = await post({ action: 'update-profile', name: '  Yasmine   Alaoui ' });
eq([renamed.user.name, renamed.user.email], ['Yasmine Alaoui', 'yasmine@studio.test'], 'trimmed name returned with the payload');
as({ ...yasmine, fullName: 'Yasmine Alaoui', displayName: 'Yasmine Alaoui' });
const renamedView = await get();
ok(renamedView.records.some((r) => r.id === ty1.id && r.assignee === 'Yasmine Alaoui'), 'renaming preserves task ownership');
await post({ action: 'update-profile', name: 'Amine Creative' });
as({ ...yasmine, fullName: 'Amine Creative', displayName: 'Amine Creative' });
ok(!(await get()).records.some((r) => r.id === ta1.id), 'matching another member’s display name cannot take their tasks');
await post({ action: 'update-profile', name: 'Yasmine Alaoui' });
as(owner);
eq((await get()).members.find((m) => m.userId === yasmine.userId).name, 'Yasmine Alaoui', 'roster reflects the new name');

// Per-person timer: start logs an open entry, a second start on the same task is rejected, stop closes it.
as(owner);
const timedTask = await t('Chrono', c1.id, p1.id, '');
const started = await post({ action: 'start-timer', taskId: timedTask.id });
const running = started.records.find((r) => r.id === timedTask.id);
eq(running.timeEntries.length, 1, 'starting the timer logs one entry');
ok(!running.timeEntries[0].end, 'the entry has no end while running');
await post({ action: 'start-timer', taskId: timedTask.id }, 409);
const stopped = await post({ action: 'stop-timer', taskId: timedTask.id });
ok(stopped.records.find((r) => r.id === timedTask.id).timeEntries[0].end, 'stopping closes the entry');
await post({ action: 'stop-timer', taskId: timedTask.id }, 409);
// The print workspace was retired: it can no longer be created, and its role is never offered.
await post({ action: 'create-print-workspace' }, 400);
await post({ action: 'invite-member', email: 'karim@studio.test', name: 'Karim Print', role: 'print_operator' }, 400);

// Job titles: several per studio member, set by managers only, never a record the browser receives.
as(owner);
const titlesOfMember = (d, userId) => d.members.find((m) => m.userId === userId).titles;
const titled = await post({ action: 'set-member-titles', userId: yasmine.userId, titles: ['Designer', '  Monteur  ', 'designer', ''] });
eq(titlesOfMember(titled, yasmine.userId), ['Designer', 'Monteur'], 'titles are trimmed and de-duplicated');
eq(titlesOfMember(await post({ action: 'set-member-titles', userId: owner.userId, titles: ['Directeur artistique'] }), owner.userId), ['Directeur artistique'], 'the owner can carry a title too');
await post({ action: 'set-member-titles', userId: contact.userId, titles: ['Designer'] }, 400);
await post({ action: 'set-member-titles', userId: yasmine.userId, titles: Array.from({ length: 9 }, (_, i) => `Métier ${i}`) }, 400);
await post({ action: 'set-member-titles', userId: yasmine.userId, titles: ['x'.repeat(41)] }, 400);
await post({ action: 'set-member-titles', userId: yasmine.userId, titles: 'Designer' }, 400);
await post({ action: 'set-member-titles', userId: 'nobody', titles: ['Designer'] }, 404);
const ownerRoster = await get();
ok(!ownerRoster.records.some((r) => r.id.startsWith('titles:')), 'titles never travel as records');
eq(titlesOfMember(ownerRoster, contact.userId), [], 'a client access has no titles');
as(yasmine);
const yRoster = await get();
eq(titlesOfMember(yRoster, yasmine.userId), ['Designer', 'Monteur'], 'a member sees the titles on the roster');
await post({ action: 'set-member-titles', userId: yasmine.userId, titles: ['Chef de projet'] }, 403);
as(owner);
eq(titlesOfMember(await post({ action: 'set-member-titles', userId: yasmine.userId, titles: [] }), yasmine.userId), [], 'an empty list clears the titles');
// Trades can be chosen right in the invitation; a client access ignores them; bad ones are refused.
const invited = await post({ action: 'invite-member', email: 'sara@studio.test', name: 'Sara Monteuse', role: 'creative', titles: ['Monteur', 'Motion designer'] });
eq(invited.members.find((m) => m.email === 'sara@studio.test').titles, ['Monteur', 'Motion designer'], 'trades picked in the invitation are kept');
const invitedClient = await post({ action: 'invite-member', email: 'boss@client.test', name: 'Client Boss', role: 'client', clientId: c1.id, titles: ['Designer'] });
eq(invitedClient.members.find((m) => m.email === 'boss@client.test').titles, [], 'a client access never carries trades');
await post({ action: 'invite-member', email: 'bad@studio.test', role: 'creative', titles: ['x'.repeat(41)] }, 400);
ok(!(await get()).members.some((m) => m.email === 'bad@studio.test'), 'a refused invitation creates nobody');
await db.query('UPDATE workspace_members SET role = $1, client_id = NULL WHERE workspace_id = $2 AND user_id = $3', ['creative', WS, amine.userId]);
await post({ action: 'set-member-titles', userId: amine.userId, titles: ['Photographe'] });
await post({ action: 'remove-member', userId: amine.userId, expectedRole: 'creative' });
eq((await pg.query('SELECT id FROM records WHERE id = $1', [`titles:${WS}:${amine.userId}`])).rows.length, 0, 'removing a member removes their titles');

// Social media manager: the Social hub for every client, a « Membre »'s reach on tasks, nothing else.
as(owner);
const smmId = idOf(await post({ action: 'invite-member', email: 'sara.smm@studio.test', name: 'Sara SMM', role: 'social' }), 'sara.smm@studio.test');
const smm = { userId: smmId, fullName: 'Sara SMM', displayName: 'Sara SMM', email: 'sara.smm@studio.test' };
as(smm);
const smmView = await get();
eq(smmView.workspace.role, 'social', 'the new role is recorded');
ok(smmView.records.filter((r) => r.kind === 'task').every((t) => !t.assignee?.trim() || t.assignee === 'Sara SMM'), 'tasks: only their own and the unassigned ones, like a Membre');
ok(!smmView.records.some((r) => r.kind === 'document'), 'no devis or factures');
const smmPost = await post({ action: 'create', kind: 'editorial_post', data: { name: 'Post du SMM', clientId: c1.id, due: '2026-12-12', targets: [{ network: 'instagram', format: 'post' }] } });
ok(smmPost.records.some((r) => r.id === smmPost.id), 'plans posts for any client');
await post({ action: 'invite-member', email: 'x.smm@studio.test', role: 'creative' }, 403);
await post({ action: 'create', kind: 'task', data: { name: 'Tâche du SMM', clientId: c1.id, status: 'À faire', due: '2026-12-20' } }, 403);
as(yasmine);
await post({ action: 'create', kind: 'editorial_post', data: { name: 'Post de Yasmine', clientId: c1.id, due: '2026-12-12' } }, 403);
as(owner);

// An administrator can't change or remove another administrator: only the owner can.
{
  as(owner);
  const nadiaId = idOf(await post({ action: 'invite-member', email: 'nadia@studio.test', name: 'Nadia Admin', role: 'admin' }), 'nadia@studio.test');
  const ridaId = idOf(await post({ action: 'invite-member', email: 'rida@studio.test', name: 'Rida Admin', role: 'admin' }), 'rida@studio.test');
  as({ userId: nadiaId, fullName: 'Nadia Admin', displayName: 'Nadia Admin', email: 'nadia@studio.test' });
  await post({ action: 'set-member-role', userId: ridaId, expectedRole: 'admin', role: 'creative' }, 403);
  await post({ action: 'remove-member', userId: ridaId, expectedRole: 'admin' }, 403);
  ok((await get()).members.some((m) => m.userId === ridaId && m.role === 'admin'), 'the other administrator is untouched');
  as(owner);
  eq((await post({ action: 'set-member-role', userId: ridaId, expectedRole: 'admin', role: 'creative' })).members.find((m) => m.userId === ridaId).role, 'creative', 'the owner can change an administrator');
  const ridaAgain = await post({ action: 'set-member-role', userId: ridaId, expectedRole: 'creative', role: 'admin' });
  ok(ridaAgain.members.some((m) => m.userId === ridaId && m.role === 'admin'), 'and give the role back');
  ok(!(await post({ action: 'remove-member', userId: ridaId, expectedRole: 'admin' })).members.some((m) => m.userId === ridaId), 'and remove an administrator');
}

await pg.close();
console.log(`${checks} role checks passed: single owner, member scope (clients, own + unassigned tasks, no task creation, read-only team), client portal scope, timer, the retired print workspace, job titles, social media manager.`);
