// Role boundaries: one owner, members see clients + their own tasks only, clients see their portal only.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
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
const c1 = await post({ action: 'create', kind: 'client', data: { name: 'Client Un' } });
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
// Saving a new deliverable link is the only edit a member can make, and it alone sends the task for validation.
const sent = await post({ action: 'update', kind: 'task', id: ty1.id, revision: 1, data: { name: 'Reel Yasmine', clientId: c1.id, projectId: p1.id, assignee: 'Yasmine Creative', status: 'En cours', due: '2026-12-01', deliverable: 'https://x.test/y1-final.mp4' } });
eq(sent.records.find((r) => r.id === ty1.id).status, 'À valider', 'the deliverable link alone moves the task to "À valider"');
ok(sent.records.find((r) => r.id === ty1.id).approvalDueAt, 'a member can send their own work to the client');
await post({ action: 'comment', taskId: ty1.id, text: 'Envoyé !' });
const awaiting = sent.records.find((r) => r.id === ty1.id);
await post({ action: 'update', kind: 'task', id: ty1.id, revision: awaiting.revision, data: { ...awaiting, status: 'Validé' } }, 403);

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
eq(libUpdated.records.find((r) => r.id === lib1.id).name, 'Prompt accroche Instagram v2', 'a member can edit any library item, not just their own');
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
as(contact);
const c = await get();
eq(c.workspace.role, 'client');
eq(ids(c, 'client'), [c1.id]);
eq(ids(c, 'project'), [p1.id]);
eq(ids(c, 'task'), [ty1.id, ta1.id, tu.id, mine.id].sort(), 'all of Client Un’s tasks, none of Client Deux’s');
ok(!c.records.some((r) => r.id === newClient.id), 'other clients invisible');
ok(c.records.filter((r) => r.kind === 'task').every((r) => !('assignee' in r)), 'assignees hidden from the client');
eq(c.members, []);
eq(ids(c, 'document'), [devis1.id, facture1.id].sort(), 'Client Un sees their own devis and facture, not Client Deux’s devis');
await post({ action: 'approve', taskId: ty1.id });
await post({ action: 'update', kind: 'task', id: ta1.id, revision: 1, data: { name: 'x', clientId: c1.id, projectId: p1.id } }, 403);

as(owner);
eq(ids(await get(), 'task').length, 5, 'the owner sees everything');
eq(ids(await get(), 'client').length, 3, 'only owner-created clients persist');
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
  }
  if (role === 'viewer') {
    const viewerView = await get();
    ok(viewerView.records.some((r) => r.kind === 'library'), 'a viewer still reads the library');
    ok(!viewerView.records.some((r) => r.kind === 'document'), 'a viewer never sees devis/factures/contrats either');
    await post({ action: 'create', kind: 'library', data: { name: 'x', category: 'prompt', content: 'y' } }, 403);
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

// Print workspace: a second workspace for the same owner, own clients, `print_operator` mirrors
// `creative`'s scoping there. Also covers the invite-time existing-account fix and the per-task timer.
as(owner);
await post({ action: 'invite-member', email: 'karim@studio.test', name: 'Karim Print', role: 'print_operator' }, 400); // not offered in the content workspace
const created = await post({ action: 'create-print-workspace' });
eq(created.workspace.id, 'ws:owner:print', 'print workspace uses the expected deterministic id');
eq(created.workspace.role, 'owner', 'the owner is owner in the print workspace too');
eq((await post({ action: 'create-print-workspace' })).workspace.id, created.workspace.id, 'creating it again is idempotent');
const PWS = created.workspace.id;
await postTo(PWS, { action: 'invite-member', email: 'karim@studio.test', name: 'Karim Print', role: 'creative' }, 400); // not offered in the print workspace
const karimInvite = await postTo(PWS, { action: 'invite-member', email: 'karim@studio.test', name: 'Karim Print', role: 'print_operator' });
const karimId = karimInvite.members.find((m) => m.email === 'karim@studio.test').userId;

// Attaching an email that already has an account elsewhere must not reset its password or sessions.
const beforeAttach = (await db.query('SELECT password_hash FROM users WHERE email = $1', ['yasmine@studio.test']))[0];
const attach = await postTo(PWS, { action: 'invite-member', email: 'yasmine@studio.test', name: 'Yasmine Creative', role: 'print_operator' });
ok(attach.invitation.existingAccount, 'attaching an existing account is flagged, not treated as a fresh invite');
const afterAttach = (await db.query('SELECT password_hash FROM users WHERE email = $1', ['yasmine@studio.test']))[0];
eq(afterAttach.password_hash, beforeAttach.password_hash, 'the existing account’s password is untouched by gaining a second workspace');

await postTo(PWS, { action: 'create', kind: 'client', data: { name: 'Client Impression' } }, 403);
await postTo(PWS, { action: 'invite-member', email: 'print-client@example.test', role: 'client', clientId: c1.id }, 400);
const orderData = { name: '500 flyers', counterparty: 'Café Test', amountCents: 150000, quantity: 500, due: '2026-12-01', orderStatus: 'production' };
const order = await postTo(PWS, { action: 'print-save', kind: 'print_order', data: orderData });
const cashData = { name: 'Acompte', counterparty: 'Café Test', counterpartyType: 'customer', amountCents: 50000, transactionDate: '2026-09-17', direction: 'in', expenseCategory: 'Paiement', orderId: order.id };
const cash = await postTo(PWS, { action: 'print-save', kind: 'print_transaction', data: cashData });
await postTo(PWS, { action: 'print-save', kind: 'print_transaction', data: { ...cashData, amountCents: -1 } }, 400);
await postTo(PWS, { action: 'print-save', kind: 'print_transaction', data: { ...cashData, amountCents: 1.5 } }, 400);
await postTo(PWS, { action: 'print-save', kind: 'print_transaction', data: { ...cashData, transactionDate: '2026-02-30' } }, 400);
await postTo(PWS, { action: 'print-save', kind: 'print_transaction', data: { ...cashData, orderId: c1.id } }, 400);
await postTo(PWS, { action: 'print-save', kind: 'print_order', id: order.id, revision: 0, data: orderData }, 409);
await postTo(PWS, { action: 'print-save', kind: 'task', data: { name: 'Bad assignee', assigneeId: amine.userId, status: 'À faire' } }, 400);
const karimTask = await postTo(PWS, { action: 'print-save', kind: 'task', data: { name: 'Flyer', orderId: order.id, assigneeId: karimId, status: 'En cours', due: '2026-12-01' } });
const otherTask = await postTo(PWS, { action: 'print-save', kind: 'task', data: { name: 'Carte de visite', orderId: order.id, assigneeId: yasmine.userId, status: 'En cours', due: '2026-12-01' } });
as({ userId: karimId, fullName: 'Karim Print', displayName: 'Karim Print', email: 'karim@studio.test' });
const karimView = await get(200, PWS);
eq(karimView.workspace.role, 'print_operator');
eq(ids(karimView, 'task'), [karimTask.id], 'a print operator only sees their own task in this workspace, mirroring a creative member');
eq(ids(karimView, 'print_transaction'), [], 'operator never receives cash records');
ok(!Object.hasOwn(karimView.records.find(r => r.id === order.id), 'amountCents'), 'operator order payload has no financial amount');
await get(403, WS);
await postTo(PWS, { action: 'print-save', kind: 'print_transaction', data: cashData }, 403);
await postTo(PWS, { action: 'print-delete', id: cash.id, revision: 1 }, 403);
await postTo(PWS, { action: 'print-task-status', id: otherTask.id, revision: 1, status: 'Validé' }, 403);
await postTo(PWS, { action: 'print-task-status', id: karimTask.id, revision: 1, status: 'Validé' });
await postTo(PWS, { action: 'print-task-status', id: karimTask.id, revision: 1, status: 'En cours' }, 409);
await postTo(PWS, { action: 'print-task-status', id: karimTask.id, revision: 2, status: 'En cours' });

// Per-person timer: start logs an open entry, a second start on the same task is rejected, stop closes it.
const started = await postTo(PWS, { action: 'start-timer', taskId: karimTask.id });
const running = started.records.find((r) => r.id === karimTask.id);
eq(running.timeEntries.length, 1, 'starting the timer logs one entry');
ok(!running.timeEntries[0].end, 'the entry has no end while running');
await postTo(PWS, { action: 'start-timer', taskId: karimTask.id }, 409);
const stopped = await postTo(PWS, { action: 'stop-timer', taskId: karimTask.id });
ok(stopped.records.find((r) => r.id === karimTask.id).timeEntries[0].end, 'stopping closes the entry');
await postTo(PWS, { action: 'stop-timer', taskId: karimTask.id }, 409);
as(owner);
const studioAfterPrint = await get();
ok(!studioAfterPrint.records.some(r => [order.id, cash.id, karimTask.id].includes(r.id)), 'printing data stays out of studio');
const voided = await postTo(PWS, { action: 'print-save', kind: 'print_transaction', id: cash.id, revision: 1, data: { ...cashData, archived: true } });
ok(voided.records.find(r => r.id === cash.id).archived, 'cash corrections preserve voided records');
await postTo(PWS, { action: 'print-save', kind: 'print_transaction', id: cash.id, revision: 1, data: cashData }, 409);
await postTo(PWS, { action: 'print-delete', id: cash.id, revision: 1 }, 409);
const deletedPayment = await postTo(PWS, { action: 'print-delete', id: cash.id, revision: 2 });
ok(!deletedPayment.records.some(r => r.id === cash.id), 'the owner can permanently delete a payment record');
// A dated printing task must never be approved by the studio content cron.
await db.query("UPDATE records SET data = data || $1::jsonb WHERE id = $2", [JSON.stringify({ status: 'À valider', approvalDueAt: '2020-01-01T00:00:00Z' }), karimTask.id]);
eq((await get(200, PWS)).records.find(r => r.id === karimTask.id).status, 'À valider', 'printing excludes automatic studio approval clocks');

// A print invoice for a company client carries its legal details; saving it again without them drops the block.
const invoiceData = { docType: 'facture', docStatus: 'draft', counterparty: 'KOJO BAKERY SARL', lineItems: [{ description: 'Cartes de visite', quantity: 500, unitPrice: 5 }], taxRate: 20 };
const billing = { company: 'KOJO BAKERY SARL', address: '265, Bd Zerktouni, Casablanca', rc: '580217', ice: '03236238000047', taxId: '53730458' };
const invoice = await postTo(PWS, { action: 'print-save', kind: 'print_document', data: { ...invoiceData, billing } });
eq(invoice.records.find(r => r.id === invoice.id).billing, billing, 'company details are stored on the document');
await postTo(PWS, { action: 'print-save', kind: 'print_document', data: { ...invoiceData, billing: { ...billing, extra: 'x' } } }, 400);
const plain = await postTo(PWS, { action: 'print-save', kind: 'print_document', id: invoice.id, revision: 1, data: { ...invoiceData, billing: null } });
ok(!('billing' in plain.records.find(r => r.id === invoice.id)), 'unticking the company client (billing: null) removes the details');
// A partial payload — what the Archiver button sends — must not blank the fields it leaves out.
const full = { docType: 'facture', docStatus: 'sent', counterparty: 'KOJO BAKERY SARL', taxRate: 20, issuedAt: '2026-09-01', dueAt: '2026-09-30', notes: 'Merci', lineItems: [{ description: 'Cartes', quantity: 500, unitPrice: 5 }], billing };
const dated = await postTo(PWS, { action: 'print-save', kind: 'print_document', data: full });
const beforeArchive = dated.records.find(r => r.id === dated.id);
const archivedDoc = await postTo(PWS, { action: 'print-save', kind: 'print_document', id: dated.id, revision: beforeArchive.revision, data: { docType: full.docType, docStatus: full.docStatus, counterparty: full.counterparty, lineItems: full.lineItems, archived: true } });
const afterArchive = archivedDoc.records.find(r => r.id === dated.id);
eq(
  [afterArchive.archived, afterArchive.number, afterArchive.taxRate, afterArchive.issuedAt, afterArchive.dueAt, afterArchive.notes, afterArchive.billing],
  [true, beforeArchive.number, 20, '2026-09-01', '2026-09-30', 'Merci', billing],
  'archiving keeps the number, dates, tax rate, notes and company details',
);

// Deleting an order: its tasks go with it, its payments stay in the ledger detached; operators cannot.
const order2 = await postTo(PWS, { action: 'print-save', kind: 'print_order', data: { ...orderData, name: '200 affiches' } });
const order2Task = await postTo(PWS, { action: 'print-save', kind: 'task', data: { name: 'Impression affiches', orderId: order2.id, status: 'À faire', assigneeId: '' } });
const order2Cash = await postTo(PWS, { action: 'print-save', kind: 'print_transaction', data: { ...cashData, name: 'Acompte affiches', orderId: order2.id } });
as({ userId: karimId, fullName: 'Karim Print', displayName: 'Karim Print', email: 'karim@studio.test' });
await postTo(PWS, { action: 'print-delete', id: order2.id, revision: 1 }, 403);
as(owner);
await postTo(PWS, { action: 'print-delete', id: order2.id, revision: 0 }, 409);
const afterOrderDelete = await postTo(PWS, { action: 'print-delete', id: order2.id, revision: 1 });
ok(!afterOrderDelete.records.some(r => r.id === order2.id || r.id === order2Task.id), 'the order and its task are gone');
const detached = afterOrderDelete.records.find(r => r.id === order2Cash.id);
eq([detached?.orderId, detached?.amountCents], ['', 50000], 'its payment is kept, no longer linked to an order');

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
await db.query('UPDATE workspace_members SET role = $1, client_id = NULL WHERE workspace_id = $2 AND user_id = $3', ['creative', WS, amine.userId]);
await post({ action: 'set-member-titles', userId: amine.userId, titles: ['Photographe'] });
await post({ action: 'remove-member', userId: amine.userId, expectedRole: 'creative' });
eq((await pg.query('SELECT id FROM records WHERE id = $1', [`titles:${WS}:${amine.userId}`])).rows.length, 0, 'removing a member removes their titles');

await pg.close();
console.log(`${checks} role checks passed: single owner, member scope (clients, own + unassigned tasks, no task creation, read-only team), client portal scope, print workspace + timer, job titles.`);
