// The One Flow through the records API: approve / request-changes / publish / request / invites / client role / lock / sweep.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';

const esbuildPath = globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0] || 'node_modules/esbuild/lib/main.js';
const esbuild = await import(pathToFileURL(esbuildPath));
mkdirSync('.sites-runtime', { recursive: true });
await esbuild.build({ entryPoints: ['app/api/records/route.ts'], outfile: '.sites-runtime/flow-api-test.mjs', bundle: true, platform: 'node', format: 'esm', plugins: [testRuntimePlugin({ auth: false })] });
const { db, pg } = await createTestDb();
globalThis.testDb = db;
const owner = { userId: 'owner-a', fullName: 'Test Owner', displayName: 'Test Owner', email: 'owner@studio.test' };
const contact = { userId: '', fullName: 'Amina Contact', displayName: 'Amina Contact', email: 'amina@client.test' }; // id assigned by the invitation
const creative = { userId: '', fullName: 'Yasmine', displayName: 'Yasmine', email: 'yasmine@studio.test' };
globalThis.testEnv = { OWNER_EMAIL: 'owner@studio.test' };
globalThis.testUser = owner;
const { GET, POST } = await import(pathToFileURL(process.cwd() + '/.sites-runtime/flow-api-test.mjs'));

let checks = 0;
const WS = 'ws:owner-a';
async function post(body, status = 200, workspaceId = WS) {
  const r = await POST(new Request('https://tracker.test/api/records', { method: 'POST', headers: { 'Content-Type': 'application/json', origin: 'https://tracker.test', ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {}) }, body: JSON.stringify(body) }));
  const d = await r.json(); assert.equal(r.status, status, JSON.stringify(d)); checks++; return d;
}
async function get(status = 200, workspaceId = WS) {
  const r = await GET(new Request('https://tracker.test/api/records', { headers: workspaceId ? { 'X-Workspace-Id': workspaceId } : {} }));
  const d = await r.json(); assert.equal(r.status, status, JSON.stringify(d)); checks++; return d;
}
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const find = (d, id) => d.records.find((r) => r.id === id);
const setData = async (id, patch) => { const row = (await pg.query('SELECT data FROM records WHERE id = $1', [id])).rows[0]; await pg.query('UPDATE records SET data = $1::jsonb WHERE id = $2', [JSON.stringify({ ...row.data, ...patch }), id]); };
const day = (offset) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };

// Setup: a client with a quota, a project, a dated task far enough out.
await get(200, null);
const c = await post({ action: 'create', kind: 'client', data: { name: 'Centre Alkhaouarizmi', quota: '8', language: 'العربية' } });
const p = await post({ action: 'create', kind: 'project', data: { name: 'Communication', clientId: c.id } });
const base = { name: 'Reel rentrée', clientId: c.id, projectId: p.id, status: 'En cours', due: day(20), source: 'Interne', deliverable: 'https://drive.test/reel.mp4' };
const t = await post({ action: 'create', kind: 'task', data: base });
ok(t.today && /^\d{4}-\d{2}-\d{2}$/.test(t.today) && Array.isArray(t.workspaces), 'payload carries the studio day and the workspace list');

// J−7 lock: creating inside the window needs an explicit admin override; creatives are refused outright.
const locked = await post({ action: 'create', kind: 'task', data: { ...base, name: 'Urgent', due: day(3) } }, 409);
eq(locked.code, 'lock');
const lifted = await post({ action: 'create', kind: 'task', data: { ...base, name: 'Urgent', due: day(3) }, lockOverride: true });
ok(find(lifted, lifted.id).lockOverride && find(lifted, lifted.id).history.some((h) => h.text.includes('Verrou J−7 levé')), 'override is recorded in history');
await post({ action: 'update', kind: 'task', id: t.id, revision: 1, data: { ...base, due: day(2) } }, 409);
await post({ action: 'update', kind: 'task', id: t.id, revision: 1, data: { ...base, name: 'Reel rentrée (v2)' } });
await post({ action: 'create', kind: 'task', data: { ...base, name: 'Backfill', due: day(-10) } }, 200);

// Sending to the client stores the 48 h deadline.
const sent = await post({ action: 'update', kind: 'task', id: t.id, revision: 2, data: { ...base, status: 'À valider' } });
const sentTask = find(sent, t.id);
ok(sentTask.sentAt && sentTask.approvalDueAt && new Date(sentTask.approvalDueAt) - new Date(sentTask.sentAt) === 48 * 3600 * 1000, '48 h clock stored');

// Invite a client contact: the account exists at once with a temporary password (shown to the studio since no mail is configured).
await post({ action: 'invite-member', email: 'amina@client.test', role: 'client' }, 400);
await post({ action: 'invite-member', email: 'amina@client.test', role: 'client', clientId: 'nope' }, 400);
const invited = await post({ action: 'invite-member', email: 'Amina@Client.test', name: 'Amina Contact', role: 'client', clientId: c.id });
const aminaRow = invited.members.find((m) => m.email === 'amina@client.test');
ok(aminaRow && aminaRow.role === 'client' && aminaRow.clientId === c.id && aminaRow.pending === true, 'member row created, pending first login');
ok(invited.invitation && invited.invitation.sent === false && /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/.test(invited.invitation.temporaryPassword), 'temporary password returned when mail is not configured');
contact.userId = aminaRow.userId;
await post({ action: 'invite-member', email: 'AMINA@client.test', role: 'creative' }, 409);
const invitedCrew = await post({ action: 'invite-member', email: 'yasmine@studio.test', name: 'Yasmine', role: 'creative' });
creative.userId = invitedCrew.members.find((m) => m.email === 'yasmine@studio.test').userId;

globalThis.testUser = contact;
const portal = await get(200, null);
eq([portal.workspace.id, portal.workspace.role, portal.workspace.clientId], [WS, 'client', c.id], 'the contact lands in the studio workspace as a client');
ok(!portal.records.some((r) => r.kind === 'client' && r.id !== c.id), 'only their own client');
ok(portal.records.every((r) => !('assignee' in r) && !('source' in r)), 'internal fields hidden');
eq(portal.members, [], 'no team roster for clients');
const visible = find(portal, t.id);
ok(visible && visible.status === 'À valider' && visible.approvalDueAt, 'the deliverable is visible with its clock');
// Clients cannot do studio things.
await post({ action: 'create', kind: 'task', data: base }, 403);
await post({ action: 'update', kind: 'task', id: t.id, revision: 3, data: base }, 403);
await post({ action: 'publish', taskId: t.id }, 403);
await post({ action: 'invite-member', email: 'x@y.test', role: 'creative' }, 403);
await post({ action: 'mark-read', ids: [] }); // Clients clear their own targeted notifications.
// …but can request changes (a counted round) and comment.
const round1 = await post({ action: 'request-changes', taskId: t.id, text: 'Le logo est trop petit.' });
const afterRound = find(round1, t.id);
eq([afterRound.status, afterRound.revisionRound, afterRound.approvalDueAt], ['En cours', 1, undefined], 'round 1 counted, clock stopped');
ok(round1.records.some((r) => r.kind === 'comment' && r.taskId === t.id && r.name.startsWith('[Retours client — tour 1]')), 'feedback lands in the single channel');
await post({ action: 'request-changes', taskId: t.id, text: 'again' }, 409);
await post({ action: 'approve', taskId: t.id }, 409);
// A request through the form waits in the studio's inbox (« Demandes »): it is not a task yet.
const requestBody = { action: 'request', clientId: 'untrusted-client', data: { name: 'Story Aïd', due: day(30), projectId: p.id, platforms: ['Instagram', 'TikTok', 'LinkedIn'], description: 'Visuel + texte', priority: 'Urgente', submissionId: crypto.randomUUID() } };
const [req, firstDuplicate] = await Promise.all([post(requestBody), post(requestBody)]);
eq(firstDuplicate.id, req.id, 'concurrent first submissions create the same request');
const requested = find(req, req.id);
eq([requested.kind, requested.requestStatus, requested.clientId, requested.projectId, requested.platforms, requested.request.email], ['request', 'new', c.id, p.id, ['Instagram', 'TikTok', 'LinkedIn'], 'amina@client.test'], 'the request waits, with every platform asked for');
eq(requested.priority, 'Urgente', 'the priority selected in the portal is saved for the client’s own request');
eq(req.records.filter((r) => r.kind === 'task' && r.name === 'Story Aïd').length, 0, 'no task is created on its own');
const retries = await Promise.all([post(requestBody), post(requestBody)]);
eq(retries.map(r => r.id), [req.id, req.id], 'simultaneous retries return the original request');
eq((await pg.query("SELECT count(*)::int AS count FROM records WHERE kind = 'request' AND data->>'name' = 'Story Aïd'")).rows[0].count, 1, 'only one request is saved');
eq((await pg.query("SELECT count(*)::int AS count FROM records WHERE kind = 'event' AND data->>'requestId' = $1", [req.id])).rows[0].count, 1, 'only one studio notification is saved');
const minimalBody = { action: 'request', clientId: c.id, data: { name: ' Sans date ni sous-projet ', projectId: '', due: '', platforms: [], description: '', priority: 'Moyenne', submissionId: crypto.randomUUID() } };
// A failure after the transaction commits used to leave clients unable to tell whether to resend.
globalThis.testDb = { ...db, transaction: async fn => {
  let savedRequest = false;
  const value = await db.transaction(tx => fn({ ...tx, query: async (text, params = []) => {
    const rows = await tx.query(text, params);
    if (text.startsWith('INSERT INTO records') && params[3] === 'request') savedRequest = true;
    return rows;
  } }));
  if (savedRequest) throw new Error('Simulated lost response after request commit');
  return value;
} };
const originalError = console.error;
console.error = () => {};
try { await post(minimalBody, 503); } finally { globalThis.testDb = db; console.error = originalError; }
const minimal = await post(minimalBody);
eq([find(minimal, minimal.id).name, find(minimal, minimal.id).due, find(minimal, minimal.id).projectId, find(minimal, minimal.id).priority], ['Sans date ni sous-projet', '', undefined, 'Moyenne'], 'the exact portal payload accepts empty optional fields');
eq(minimal.records.filter(r => r.kind === 'request' && r.name === 'Sans date ni sous-projet').length, 1, 'resending after a lost response does not duplicate the request');
await post({ action: 'request', data: { name: '', due: day(30) } }, 400);
await post({ action: 'request', data: { name: 'x', priority: 'critical' } }, 400);
await post({ action: 'request', data: { name: 'x', submissionId: 'not-a-uuid' } }, 400);
await post({ action: 'request', data: { name: 'x', due: '2026-02-30' } }, 400);
await post({ action: 'request', data: { name: 'x', projectId: 'other' } }, 400);
await post({ action: 'request', data: { name: 'x', platforms: ['MySpace'] } }, 400);
const legacy = await post({ action: 'request', data: { name: 'Ancien formulaire', channel: 'Facebook' } });
eq(find(legacy, legacy.id).platforms, ['Facebook'], 'the old single channel still arrives as a platform');
await post({ action: 'request-accept', id: req.id, data: { name: 'x' } }, 403);
await post({ action: 'request-decline', id: legacy.id, reason: 'x' }, 403);

// Studio resends, the client approves explicitly: sign-off receipt written.
globalThis.testUser = owner;
const owned = await get();
ok(owned.records.some((r) => r.kind === 'event' && r.type === 'request' && r.requestId === req.id && r.recipients?.includes(owner.userId)), 'the owner is told about the request');
// Declining needs a reason the client will read; accepting makes the task, prefilled from the request.
await post({ action: 'request-decline', id: legacy.id, reason: '  ' }, 400);
const declined = await post({ action: 'request-decline', id: legacy.id, reason: 'Déjà prévu dans le plan de novembre.' });
eq([find(declined, legacy.id).requestStatus, find(declined, legacy.id).decision.reason], ['declined', 'Déjà prévu dans le plan de novembre.'], 'declined, with the reason');
await post({ action: 'request-accept', id: legacy.id, data: { name: 'x' } }, 409);
await post({ action: 'request-accept', id: req.id, data: { name: 'x', assigneeId: contact.userId } }, 400);
const accepted = await post({ action: 'request-accept', id: req.id, data: { name: 'Story Aïd — 2 formats', due: day(28), description: 'Visuel + texte, version arabe' } });
const made = find(accepted, accepted.id);
eq([made.kind, made.status, made.projectId, made.due, made.channel, made.source, made.request.email], ['task', 'À faire', p.id, day(28), 'Instagram', 'Portail', 'amina@client.test'], 'the task is made in the request’s sub-project, with the date the studio chose');
eq(made.priority, 'Urgente', 'the accepted task preserves the requested priority');
ok(made.description.includes('Plateformes : Instagram, TikTok, LinkedIn'), 'every requested platform is kept in the brief');
eq([find(accepted, req.id).requestStatus, find(accepted, req.id).taskId], ['accepted', made.id], 'the request points to its task');
await post({ action: 'request-accept', id: req.id, data: { name: 'again' } }, 409);
globalThis.testUser = contact;
eq((await post(requestBody)).id, req.id, 'retrying a request after acceptance returns the same request without reopening it');
const portalNow = await get();
eq(portalNow.records.filter((r) => r.kind === 'request').map((r) => [r.name, r.requestStatus]).sort(), [['Ancien formulaire', 'declined'], ['Sans date ni sous-projet', 'new'], ['Story Aïd', 'accepted']], 'the client sees where each request stands');
ok(portalNow.records.some((r) => r.kind === 'event' && r.requestId === legacy.id && r.name.includes('Déjà prévu dans le plan de novembre.')), 'and why one was declined');
ok(portalNow.records.some((r) => r.kind === 'event' && r.requestId === req.id && r.taskId === made.id), 'and that the other is accepted');
globalThis.testUser = owner;
const ownedAfter = await get();
const studioRequest = await post({ ...requestBody, clientId: c.id, data: { ...requestBody.data, name: 'Saisie studio' } });
ok(studioRequest.id !== req.id, 'another authenticated sender cannot collide with a client’s submission key');
eq(find(ownedAfter, made.id).source, 'Portail', 'source recorded for the studio');
ok(owned.members.find((m) => m.userId === contact.userId && m.role === 'client' && m.clientId === c.id && m.email === contact.email), 'the contact is a member');
await post({ action: 'update', kind: 'task', id: t.id, revision: find(owned, t.id).revision, data: { ...base, status: 'À valider' } });
globalThis.testUser = contact;
const approved = await post({ action: 'approve', taskId: t.id });
const signed = find(approved, t.id);
eq([signed.status, signed.signOff.mode, signed.signOff.by, signed.signOff.email, signed.signOff.round], ['Validé', 'explicit', 'Amina Contact', 'amina@client.test', 1]);
await post({ action: 'approve', taskId: t.id }, 409);

// Only the client, the owner and administrators sign off: member roles (creative, social) are refused on both actions.
{
  globalThis.testUser = owner;
  const waiting = async (name) => (await post({ action: 'create', kind: 'task', data: { ...base, name, due: day(25), status: 'À valider' } })).id;
  const [w1, w2, w3] = [await waiting('Aval 1'), await waiting('Aval 2'), await waiting('Aval 3')];
  const nadiaInvite = await post({ action: 'invite-member', email: 'nadia@studio.test', name: 'Nadia Admin', role: 'admin' });
  const nadia = { userId: nadiaInvite.members.find((m) => m.email === 'nadia@studio.test').userId, fullName: 'Nadia Admin', displayName: 'Nadia Admin', email: 'nadia@studio.test' };
  const refused = async () => {
    await post({ action: 'approve', taskId: w1 }, 403);
    await post({ action: 'request-changes', taskId: w1, text: 'Retouche' }, 403);
  };
  globalThis.testUser = creative;
  await refused();
  await pg.query("UPDATE workspace_members SET role = 'social' WHERE workspace_id = $1 AND user_id = $2", [WS, creative.userId]);
  await refused();
  await pg.query("UPDATE workspace_members SET role = 'creative' WHERE workspace_id = $1 AND user_id = $2", [WS, creative.userId]);
  globalThis.testUser = owner;
  eq(find(await get(), w1).status, 'À valider', 'the refused member actions changed nothing');
  eq(find(await post({ action: 'approve', taskId: w1 }), w1).signOff.mode, 'studio', 'the owner can still validate');
  globalThis.testUser = nadia;
  eq(find(await post({ action: 'approve', taskId: w2 }), w2).status, 'Validé', 'an administrator can still validate');
  eq(find(await post({ action: 'request-changes', taskId: w3, text: 'Retouche' }), w3).status, 'En cours', 'an administrator can still request changes');
  globalThis.testUser = owner;
}

// Internal work: no lock, never published, deletable by managers only (with its comments and events).
globalThis.testUser = owner;
const internal = await post({ action: 'create', kind: 'task', data: { ...base, name: 'Copywriting', due: day(2), status: 'Validé', publishable: false } });
ok(internal.records.find((r) => r.id === internal.id).publishable === false, 'internal task created inside the lock window without override');
await post({ action: 'publish', taskId: internal.id }, 409);
await post({ action: 'comment', taskId: internal.id, text: 'note' });
globalThis.testUser = creative;
await post({ action: 'delete', kind: 'task', id: internal.id, revision: 1 }, 403);
globalThis.testUser = owner;
await post({ action: 'delete', kind: 'task', id: internal.id, revision: 99 }, 409);
const deleted = await post({ action: 'delete', kind: 'task', id: internal.id, revision: 1 });
ok(!deleted.records.some((r) => r.id === internal.id || r.taskId === internal.id), 'task, its comments and events are gone');
await post({ action: 'delete', kind: 'task', id: internal.id, revision: 1 }, 404);

// Publish (studio only, validated only), then evergreen rules.
globalThis.testUser = owner;
await post({ action: 'publish', taskId: lifted.id }, 409);
const published = await post({ action: 'publish', taskId: t.id, day: day(20) });
ok(find(published, t.id).publishedAt.startsWith(day(20)), 'published on the given day');
await post({ action: 'publish', taskId: t.id }, 409);
await post({ action: 'create', kind: 'task', data: { ...base, name: 'Reserve', due: day(40), evergreen: true } }, 400);
const reserve = await post({ action: 'create', kind: 'task', data: { ...base, name: 'Reserve', due: '', status: 'Validé', evergreen: true } });
ok(find(reserve, reserve.id).evergreen && find(reserve, reserve.id).signOff.mode === 'studio', 'studio validation writes a studio receipt');
const scheduled = await post({ action: 'update', kind: 'task', id: reserve.id, revision: 1, data: { ...base, name: 'Reserve', due: day(30), status: 'Validé' } });
ok(find(scheduled, reserve.id).evergreen === false && find(scheduled, reserve.id).history.some((h) => h.text.startsWith('Sorti de la réserve')), 'dating a reserve item takes it out of the reserve');

// The sweep: an expired clock is applied on the next read, once, with an event; stale revisions are rejected afterwards.
const expiring = await post({ action: 'create', kind: 'task', data: { ...base, name: 'Silence', due: day(25), status: 'À valider' } });
await setData(expiring.id, { approvalDueAt: new Date(Date.now() - 60000).toISOString(), sentAt: new Date(Date.now() - 49 * 3600 * 1000).toISOString() });
const swept = await get();
const auto = find(swept, expiring.id);
eq([auto.status, auto.signOff.mode, auto.revision], ['Validé', 'silence', 2], 'silence approved, revision bumped');
ok(swept.records.some((r) => r.kind === 'event' && r.type === 'auto-approved' && r.taskId === expiring.id), 'auto-approval event written');
eq(swept.records.filter((r) => r.kind === 'event' && r.type === 'auto-approved' && r.taskId === expiring.id).length, 1);
await post({ action: 'update', kind: 'task', id: expiring.id, revision: 1, data: { ...base, name: 'Silence', due: day(25), status: 'En cours' } }, 409);
const again = await get();
eq(again.records.filter((r) => r.kind === 'event' && r.taskId === expiring.id).length, swept.records.filter((r) => r.kind === 'event' && r.taskId === expiring.id).length, 'idempotent: neither approval nor WhatsApp events repeat');
// Reminder bookkeeping does not bump revisions.
const reminding = await post({ action: 'create', kind: 'task', data: { ...base, name: 'Reminder', due: day(25), status: 'À valider' } });
await setData(reminding.id, { approvalDueAt: new Date(Date.now() + 20 * 3600 * 1000).toISOString() });
const reminded = find(await get(), reminding.id);
eq([reminded.reminders, reminded.revision], [['24h'], 1], 'reminder recorded without invalidating open editors');
ok(swept.records.some((r) => r.kind === 'event' && r.type === 'reminder') || (await get()).records.some((r) => r.kind === 'event' && r.type === 'reminder'), 'reminder event exists');
// Mark-read flips events for the studio.
const unreadIds = (await get()).records.filter((r) => r.kind === 'event' && !r.read).map((r) => r.id);
const read = await post({ action: 'mark-read', ids: unreadIds });
ok(read.records.filter((r) => r.kind === 'event').every((r) => r.read || r.readBy?.includes(owner.userId) || (r.recipients && !r.recipients.includes(owner.userId))), 'all events read');

// Per-person notifications: assigning a task targets only the new assignee (not a studio-wide
// broadcast like before); a studio comment and a client comment on that task then also notify the
// assignee specifically.
globalThis.testUser = owner;
const beforeAssign = find(await get(), t.id);
const assigned = await post({ action: 'update', kind: 'task', id: t.id, revision: beforeAssign.revision, data: { ...base, status: 'Validé', assignee: 'Yasmine', assigneeId: creative.userId } });
const assignEvent = assigned.records.find((r) => r.kind === 'event' && r.type === 'task-assigned' && r.taskId === t.id);
eq(assignEvent.recipients, [creative.userId], 'task-assigned targets only the new assignee, not the whole studio');
eq(assignEvent.readBy, [], 'unread for its recipient to start');
const studioComment = await post({ action: 'comment', taskId: t.id, text: 'Studio note for Yasmine.' });
const studioCommentEvent = studioComment.records.find((r) => r.kind === 'event' && r.type === 'comment' && r.audience === 'studio' && r.taskId === t.id);
ok(studioCommentEvent?.recipients?.includes(creative.userId), 'a studio comment on an assigned task notifies the assignee specifically');
globalThis.testUser = contact;
await post({ action: 'comment', taskId: t.id, text: 'Client note.' });
globalThis.testUser = owner;
// audience:'studio' events never reach the client's own response (portalView strips them) — check
// from the studio side, which is also who this notification is actually for.
const clientCommentEvent = (await get()).records.find((r) => r.kind === 'event' && r.type === 'comment' && r.audience === 'studio' && r.taskId === t.id && r.name.includes('Client note'));
ok(clientCommentEvent?.recipients?.includes(creative.userId), 'a client comment on an assigned task also targets the assignee, not a studio-wide broadcast');

// Per-recipient read state: the assignee marks their own notifications read without touching
// anyone else's copy of the same events.
globalThis.testUser = creative;
const myUnread = (await get()).records.filter((r) => r.kind === 'event' && r.recipients?.includes(creative.userId) && !r.readBy?.includes(creative.userId));
ok(myUnread.length >= 2, 'the assignee has the assignment and both comment notifications unread');
const afterMark = await post({ action: 'mark-read', ids: myUnread.map((r) => r.id) });
ok(afterMark.records.filter((r) => myUnread.some((u) => u.id === r.id)).every((r) => r.readBy.includes(creative.userId)), 'marking read records this person specifically');
globalThis.testUser = owner;
const ownerView = await get();
ok(ownerView.records.filter((r) => myUnread.some((u) => u.id === r.id)).every((r) => !r.readBy.includes(owner.userId)), 'the owner, not a recipient, is untouched by the assignee’s mark-read');

// Read-all clears the complete personal inbox (not just 30 displayed rows or 200 IDs),
// preserves other recipients and broadcast alerts, and remains scoped to the workspace.
const inboxEvents = Array.from({ length: 221 }, (_, i) => ({
  id: `evt:read-all:${i}`, kind: 'event', name: `Inbox ${i}`, type: 'comment',
  taskId: t.id, createdAt: new Date().toISOString(),
  recipients: [creative.userId, owner.userId, contact.userId], readBy: [],
}));
const untouchedEvents = [
  { ...inboxEvents[0], id: 'evt:read-all:other-recipient', recipients: [owner.userId] },
  { ...inboxEvents[0], id: 'evt:read-all:broadcast', recipients: undefined, read: false },
];
await pg.query(`INSERT INTO records (id, owner, workspace_id, kind, data)
  SELECT e->>'id', $2, $3, 'event', e FROM jsonb_array_elements($1::jsonb) e`,
  [JSON.stringify([...inboxEvents, ...untouchedEvents]), owner.userId, WS]);
await pg.query('INSERT INTO workspaces (id, name, created_by) VALUES ($1, $2, $3)', ['ws:read-all:other', 'Other workspace', owner.userId]);
const otherWorkspaceEvent = { ...inboxEvents[0], id: 'evt:read-all:other-workspace' };
await pg.query('INSERT INTO records (id, owner, workspace_id, kind, data) VALUES ($1, $2, $3, $4, $5::jsonb)',
  [otherWorkspaceEvent.id, owner.userId, 'ws:read-all:other', 'event', JSON.stringify(otherWorkspaceEvent)]);
globalThis.testUser = creative;
const readAll = await post({ action: 'mark-read', all: true });
eq(readAll.records.filter((r) => r.id.startsWith('evt:read-all:') && /^Inbox /.test(r.name) && r.recipients?.includes(creative.userId)).length, 221);
ok(inboxEvents.every((e) => find(readAll, e.id)?.readBy?.includes(creative.userId)), 'all 221 notifications are marked read');
ok(inboxEvents.every((e) => find(readAll, e.id)?.readBy?.length === 1), 'other recipients stay unread');
ok(!find(readAll, untouchedEvents[0].id).readBy.length && !find(readAll, untouchedEvents[1].id).read, 'other recipients and broadcast alerts stay untouched');
eq((await pg.query('SELECT data FROM records WHERE id = $1', [otherWorkspaceEvent.id])).rows[0].data.readBy, [], 'another workspace is untouched');
await post({ action: 'mark-read', all: true });
eq((await pg.query('SELECT data FROM records WHERE id = $1', [inboxEvents[0].id])).rows[0].data.readBy, [creative.userId], 'read-all is idempotent');
globalThis.testUser = contact;
const clientReadAll = await post({ action: 'mark-read', all: true });
ok(inboxEvents.every((e) => find(clientReadAll, e.id)?.readBy?.includes(contact.userId)), 'client contacts can mark their own inbox read');
ok(inboxEvents.every((e) => !find(clientReadAll, e.id)?.readBy?.includes(owner.userId)), 'client read-all leaves the owner unread');
globalThis.testUser = owner;

// Client notice: manager-only, and fails cleanly (rather than silently doing nothing) when SMTP
// isn't configured — true for every test run, since env is fully swapped out above.
globalThis.testUser = creative;
await post({ action: 'notify-client', clientId: c.id }, 403);
globalThis.testUser = owner;
await post({ action: 'notify-client', clientId: c.id }, 400);

// Creative invite claims into the studio; creatives cannot lift the lock or invite.
globalThis.testUser = creative;
const crew = await get(200, null);
eq([crew.workspace.id, crew.workspace.role], [WS, 'creative']);
await post({ action: 'create', kind: 'task', data: { ...base, name: 'Rush', due: day(2) } }, 403);
await post({ action: 'create', kind: 'task', data: { ...base, name: 'Rush', due: day(2) }, lockOverride: true }, 403);
await post({ action: 'invite-member', email: 'z@z.test', role: 'creative' }, 403);

// Removing the client's access ends the portal; nobody but the owner ever gets a workspace of their own.
globalThis.testUser = owner;
await post({ action: 'set-member-role', userId: contact.userId, expectedRole: 'client', role: 'client', clientId: 'missing' }, 400);
await post({ action: 'remove-member', userId: contact.userId, expectedRole: 'client' });
globalThis.testUser = contact;
await get(403, WS);
const fallback = await get(403, null);
eq(fallback.code, 'no-workspace', 'no workspace is created for a revoked account');

console.log(`${checks} flow API checks passed: J−7 lock, 48 h clock, invitations, client portal scope, rounds, receipts, publish, evergreen, sweep idempotence and revocation.`);
