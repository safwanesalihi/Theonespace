// WhatsApp "ready to approve": the message goes out when a task is sent for the client's approval,
// with the approved template's three variables, and a failure never costs the save.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';

const esbuildPath = globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0] || 'node_modules/esbuild/lib/main.js';
const esbuild = await import(pathToFileURL(esbuildPath));
mkdirSync('.sites-runtime', { recursive: true });
await esbuild.build({ entryPoints: ['app/api/records/route.ts'], outfile: '.sites-runtime/whatsapp-test.mjs', bundle: true, platform: 'node', format: 'esm', plugins: [testRuntimePlugin({ auth: false })] });
const { db, pg } = await createTestDb();
globalThis.testDb = db;
const baseEnv = { OWNER_EMAIL: 'owner@studio.test', AUTH_URL: 'https://space.test' };
const whatsappEnv = { WHATSAPP_TOKEN: 'test-token', WHATSAPP_PHONE_NUMBER_ID: '1234567890', WHATSAPP_TEMPLATE: 'pret_a_valider' };
// lib/env binds this object once at import, so configuration changes mid-test mutate it in place.
const env = { ...baseEnv, ...whatsappEnv };
globalThis.testEnv = env;
globalThis.testUser = { userId: 'owner', fullName: 'Owner', displayName: 'Owner', email: 'owner@studio.test' };
const { GET, POST } = await import(pathToFileURL(process.cwd() + '/.sites-runtime/whatsapp-test.mjs'));

// Meta's API, stubbed: record every call and answer with whatever the test asks for.
const sent = [];
let reply = { status: 200, body: { messages: [{ id: 'wamid.TEST' }] } };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith('https://graph.facebook.com/')) return realFetch(url, init);
  const body = JSON.parse(init.body);
  sent.push({ url: String(url), headers: init.headers, body });
  const r = typeof reply === 'function' ? reply(body) : reply;
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
};

let checks = 0;
const WS = 'ws:owner';
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
async function post(body, status = 200, ws = WS) {
  const r = await POST(new Request('https://space.test/api/records', { method: 'POST', headers: { 'Content-Type': 'application/json', origin: 'https://space.test', 'X-Workspace-Id': ws }, body: JSON.stringify(body) }));
  const d = await r.json(); assert.equal(r.status, status, JSON.stringify(d)); checks++; return d;
}
await GET(new Request('https://space.test/api/records'));

// The number is validated on the client file, and accepted as a person would type it.
for (const number of ['061234567', '06123456780', '+212 6 12 34 56 780', '+21261234567', '+212612345678 ext 9', '+212/612345678', '612345678', 612345678, null, '+212' + ' '.repeat(61) + '612345678']) {
  const rejected = await post({ action: 'create', kind: 'client', data: { name: 'Invalid contact', whatsapp: number } }, 400);
  if (number === '+212 6 12 34 56 780') ok(/9 chiffres après \+212/.test(rejected.error), 'an extra subscriber digit is explained rather than silently removed');
}
const formats = [
  ['0612345678', '+212612345678'], ['06 12 34 56 78', '+212612345678'],
  ['+212 612345678', '+212612345678'], ['+212 6 12 34 56 78', '+212612345678'],
  ['  +212\u00a06\u00a012\u00a034\u00a056\u00a078  ', '+212612345678'],
  ['00212 (6) 12-34.56 78', '+212612345678'], ['212612345678', '+212612345678'],
  ['+212 (0)6 12 34 56 78', '+212612345678'], ['٠٦١٢٣٤٥٦٧٨', '+212612345678'],
  ['۰۶۱۲۳۴۵۶۷۸', '+212612345678'], ['＋２１２ ６１２３４５６７８', '+212612345678'],
  ['\u200f+212 6–12–34–56–78\u200e', '+212612345678'],
  ['0712345678', '+212712345678'], ['0512345678', '+212512345678'],
  ['+33 6 12 34 56 78', '+33612345678'], ['0044 7700 900123', '+447700900123'],
];
let formatContact = await post({ action: 'create', kind: 'client', data: { name: 'Phone format checks', whatsapp: formats[0][0] } });
eq(formatContact.records.find(r => r.id === formatContact.id).whatsapp, formats[0][1], 'client creation accepts a local Moroccan number');
const formatId = formatContact.id;
for (const [number, canonical] of formats) {
  const revision = formatContact.records.find(r => r.id === formatId).revision;
  formatContact = await post({ action: 'update', kind: 'client', id: formatId, revision, data: { name: 'Phone format checks', whatsapp: number } });
  eq(formatContact.records.find(r => r.id === formatId).whatsapp, canonical, `client edit normalizes ${number}`);
}
formatContact = await post({ action: 'update', kind: 'client', id: formatId, revision: formatContact.records.find(r => r.id === formatId).revision, data: { name: 'Phone format checks', whatsapp: '' } });
eq(formatContact.records.find(r => r.id === formatId).whatsapp, '', 'an empty contact can still be cleared');
const client = await post({ action: 'create', kind: 'client', data: { name: 'Kojo Bakery', whatsapp: '+212 6 12-34.56 78', language: 'Français' } });
eq(client.records.find((r) => r.id === client.id).whatsapp, '+212612345678', 'spaces, dots and dashes are dropped');
const arabic = await post({ action: 'create', kind: 'client', data: { name: 'مخبزة', whatsapp: '+212700000000', language: 'العربية' } });
const silent = await post({ action: 'create', kind: 'client', data: { name: 'Sans WhatsApp' } });

const task = (clientId, name) => post({ action: 'create', kind: 'task', data: { name, clientId, status: 'En cours', due: '2027-03-01' } });
// A task only goes for approval with a deliverable to look at — that gate is the app's, not this test's.
const toApprove = (t, data) => post({ action: 'update', kind: 'task', id: t.id, revision: t.records.find((r) => r.id === t.id).revision, data: { deliverable: 'https://drive.test/file', ...data, status: 'À valider' } });

// 1. Sent for approval → one message, the template and its three variables, to the right number.
const t1 = await task(client.id, 'Reel de lancement');
const r1 = await toApprove(t1, { name: 'Reel de lancement', clientId: client.id, due: '2027-03-01' });
eq(r1.whatsapp, { sent: true }, 'the caller is told the message went out');
eq(sent.length, 1, 'exactly one message');
const m = sent[0];
eq(m.url, 'https://graph.facebook.com/v21.0/1234567890/messages', 'sent from the configured number id');
eq(m.headers.Authorization, 'Bearer test-token', 'authenticated with the configured token');
eq([m.body.messaging_product, m.body.to, m.body.type], ['whatsapp', '212612345678', 'template'], 'a template message to the number without its "+"');
eq([m.body.template.name, m.body.template.language.code], ['pret_a_valider', 'fr'], 'the approved template, in French');
eq(m.body.template.components[0].parameters.map((p) => p.text), ['Kojo Bakery', 'Reel de lancement', 'https://space.test/login'], '{{1}} client, {{2}} deliverable, {{3}} portal address');
ok(r1.records.some((r) => r.kind === 'event' && r.type === 'whatsapp' && r.taskId === t1.id && /envoyé/.test(r.name)), 'the studio feed records that it was sent');

// 2. Every client gets the French template — an Arabic-speaking one included.
const t2 = await task(arabic.id, 'Story');
await toApprove(t2, { name: 'Story', clientId: arabic.id, due: '2027-03-01' });
eq(sent.at(-1).body.template.language.code, 'fr', 'French for everyone, whatever the language on the client file');

// 3. No number on the client file → no message, no event, nothing surprising in the response.
const t3 = await task(silent.id, 'Affiche');
const before = sent.length;
const r3 = await toApprove(t3, { name: 'Affiche', clientId: silent.id, due: '2027-03-01' });
eq(sent.length, before, 'no number, no message');
eq(r3.whatsapp.sent, false, 'missing recipient is visible');
ok(/fiche du client/.test(r3.whatsapp.error), 'missing recipient says where to add the number');

// 4. Meta refuses → the save still stands; the error is reported and logged for the studio.
const notInLanguage = (lang) => ({ status: 400, body: { error: { code: 132001, message: '(#132001) Template name does not exist in the translation', error_data: { details: `template name (pret_a_valider) does not exist in ${lang}` } } } });
// 4a. The template was filed under English in WhatsApp Manager: found by trying the usual codes, then remembered.
reply = (body) => (body.template.language.code === 'en_US' ? { status: 200, body: { messages: [{ id: 'wamid.EN' }] } } : notInLanguage(body.template.language.code));
let before4 = sent.length;
const t4a = await task(client.id, 'Bannière');
const r4a = await toApprove(t4a, { name: 'Bannière', clientId: client.id, due: '2027-03-01' });
eq(r4a.whatsapp.sent, true, 'a template filed under another language code is still found');
eq(sent.slice(before4).map((m) => m.body.template.language.code), ['fr', 'fr_FR', 'fr_CA', 'en_US'], 'French first, then the usual codes — refused tries send nothing');
before4 = sent.length;
const t4b = await task(client.id, 'Story');
eq((await toApprove(t4b, { name: 'Story', clientId: client.id, due: '2027-03-01' })).whatsapp.sent, true);
eq(sent.slice(before4).map((m) => m.body.template.language.code), ['en_US'], 'the working code is remembered: one call next time');
// 4b. Not on this account in any language: a clear explanation instead of Meta's code.
reply = (body) => notInLanguage(body.template.language.code);
const t4 = await task(client.id, 'Carrousel');
const r4 = await toApprove(t4, { name: 'Carrousel', clientId: client.id, due: '2027-03-01' });
eq(r4.records.find((r) => r.id === t4.id).status, 'À valider', 'a failed message never undoes the save');
eq(r4.whatsapp.sent, false);
ok(/ne trouve le modèle « pret_a_valider » dans aucune langue/.test(r4.whatsapp.error), 'missing everywhere: said plainly');
ok(/même compte WhatsApp Business que le numéro d’envoi/.test(r4.whatsapp.error), 'with what to check');
ok(r4.records.some((r) => r.kind === 'event' && r.type === 'whatsapp' && r.taskId === t4.id && /non envoyé/.test(r.name)), 'the failure is in the studio feed too');
// 4c. Any other refusal: Meta's own reason, its details, and what was asked for.
reply = { status: 400, body: { error: { code: 132000, message: '(#132000) Number of parameters does not match the expected number of params', error_data: { details: 'body: number of localizable_params (3) does not match the expected number of params (2)' } } } };
const t4c = await task(client.id, 'Flyer');
const r4c = await toApprove(t4c, { name: 'Flyer', clientId: client.id, due: '2027-03-01' });
ok(/Number of parameters does not match/.test(r4c.whatsapp.error), 'Meta’s own reason is passed on');
ok(/expected number of params \(2\)/.test(r4c.whatsapp.error), 'with Meta’s details');
ok(/modèle « pret_a_valider », langue « en_US »/.test(r4c.whatsapp.error), 'and the template name and language that were asked for');
reply = { status: 200, body: { messages: [{ id: 'wamid.TEST' }] } };

// 5. Meta unreachable → same: the save stands.
globalThis.fetch = async (url, init) => { if (String(url).startsWith('https://graph.facebook.com/')) throw new TypeError('fetch failed'); return realFetch(url, init); };
const t5 = await task(client.id, 'Vidéo');
const r5 = await toApprove(t5, { name: 'Vidéo', clientId: client.id, due: '2027-03-01' });
eq([r5.records.find((r) => r.id === t5.id).status, r5.whatsapp.sent], ['À valider', false], 'a network failure never undoes the save either');

// 6. Not configured → the feature is simply off.
for (const key of Object.keys(whatsappEnv)) delete env[key];
const count = sent.length;
const t6 = await task(client.id, 'Hors config');
const r6 = await toApprove(t6, { name: 'Hors config', clientId: client.id, due: '2027-03-01' });
eq(sent.length, count, 'no configuration, no call');
eq(r6.whatsapp.sent, false, 'missing configuration is no longer silently skipped');
ok(/WHATSAPP_TOKEN.*WHATSAPP_PHONE_NUMBER_ID.*WHATSAPP_TEMPLATE/.test(r6.whatsapp.error), 'missing settings are listed without secrets');

// 7. Only the move INTO "À valider" sends — an unrelated edit while it waits does not resend.
Object.assign(env, whatsappEnv);
globalThis.fetch = async (url, init) => { if (String(url).startsWith('https://graph.facebook.com/')) { sent.push({ body: JSON.parse(init.body) }); return new Response('{"messages":[{"id":"x"}]}', { status: 200 }); } return realFetch(url, init); };
const t7 = await task(client.id, 'Une seule fois');
const r7 = await toApprove(t7, { name: 'Une seule fois', clientId: client.id, due: '2027-03-01' });
const once = sent.length;
const waiting = r7.records.find((r) => r.id === t7.id);
await post({ action: 'update', kind: 'task', id: t7.id, revision: waiting.revision, data: { name: 'Une seule fois', clientId: client.id, due: '2027-03-01', status: 'À valider', deliverable: 'https://drive.test/file', description: 'précision' } });
eq(sent.length, once, 'editing a task that is already waiting does not message the client again');

// « Nouveau message »: when the studio writes in a task's chat, the client hears on WhatsApp — with the
// optional second template only, from whoever wrote, and at most once per task every two hours.
{
  Object.assign(env, whatsappEnv);
  reply = { status: 200, body: { messages: [{ id: 'wamid.MSG' }] } };
  const chatTask = await task(client.id, 'Carrousel soldes');
  const before = sent.length;
  await post({ action: 'comment', taskId: chatTask.id, text: 'Voici la première version.' });
  eq(sent.length, before, 'without the message template, nothing is sent');
  env.WHATSAPP_COMMENT_TEMPLATE = 'nouveau_message';
  await post({ action: 'comment', taskId: chatTask.id, text: 'Et la seconde version.' });
  eq(sent.length, before, 'the chat save returns before the external WhatsApp request');
  for (const callback of globalThis.testAfter.splice(0)) await callback();
  eq(sent.length, before + 1, 'with it, the client hears about the message');
  const notice = sent.at(-1).body;
  eq([notice.template.name, notice.template.language.code, notice.to], ['nouveau_message', 'fr', '212612345678'], 'the message template, in French, to the client’s number');
  eq(notice.template.components[0].parameters.map((p) => p.text), ['Kojo Bakery', 'Owner', 'Carrousel soldes', 'https://space.test/login'], 'client, who wrote, the task, the portal');
  const activity = await (await GET(new Request('https://space.test/api/records', { headers: { 'X-Workspace-Id': WS } }))).json();
  ok(activity.records.some((r) => r.kind === 'event' && r.type === 'whatsapp' && r.taskId === chatTask.id && r.name.startsWith('WhatsApp envoyé')), 'the studio sees it went out');
  await post({ action: 'comment', taskId: chatTask.id, text: 'Encore une précision.' });
  for (const callback of globalThis.testAfter.splice(0)) await callback();
  eq(sent.length, before + 1, 'not again within two hours on the same task');
  const other = await task(silent.id, 'Sans numéro');
  await post({ action: 'comment', taskId: other.id, text: 'Bonjour' });
  eq(sent.length, before + 1, 'a client without a number gets nothing');
  delete env.WHATSAPP_COMMENT_TEMPLATE;
}


// Members' WhatsApp contacts, permissions, stable assignment identity and failure recovery.
{
  globalThis.testUser = { userId: 'owner', fullName: 'Owner', displayName: 'Owner', email: 'owner@studio.test' };
  for (const [id, name] of [['designer-a', 'Designer A'], ['designer-b', 'Designer B']]) {
    await db.query('INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4)', [id, name, `${id}@studio.test`, 'test-only-hash']);
  }
  await post({ action: 'invite-member', email: 'designer-a@studio.test', name: 'Designer A', role: 'creative', whatsapp: '061234567' }, 400);
  const invited = await post({ action: 'invite-member', email: 'designer-a@studio.test', name: 'Designer A', role: 'creative', whatsapp: '0611223344' });
  eq(invited.members.find(m => m.userId === 'designer-a').whatsapp, '+212611223344', 'invitation stores a normalized workspace contact');
  await post({ action: 'invite-member', email: 'designer-b@studio.test', name: 'Designer B', role: 'creative' });
  for (const [number, canonical] of formats) {
    const saved = await post({ action: 'set-member-whatsapp', userId: 'designer-b', whatsapp: number });
    eq(saved.members.find(m => m.userId === 'designer-b').whatsapp, canonical, `member edit normalizes ${number}`);
  }
  const memberBeforeInvalid = (await db.query('SELECT data FROM records WHERE id = $1', [`whatsapp:${WS}:designer-b`]))[0].data;
  await post({ action: 'set-member-whatsapp', userId: 'designer-b', whatsapp: '+212 6 12 34 56 780' }, 400);
  eq((await db.query('SELECT data FROM records WHERE id = $1', [`whatsapp:${WS}:designer-b`]))[0].data, memberBeforeInvalid, 'invalid member input preserves their contact');
  await post({ action: 'set-member-whatsapp', userId: 'designer-b', whatsapp: '+212 6 55 66 77 88' });
  await post({ action: 'set-member-whatsapp', userId: 'owner', whatsapp: '+212600000001' });
  await post({ action: 'set-member-whatsapp', userId: 'not-in-workspace', whatsapp: '+212600000002' }, 404);
  const a = { userId: 'designer-a', fullName: 'Designer A', displayName: 'Designer A', email: 'designer-a@studio.test' };
  const owner = globalThis.testUser;
  globalThis.testUser = a;
  const own = await GET(new Request('https://space.test/api/records', { headers: { 'X-Workspace-Id': WS } })).then(r => r.json());
  eq(own.members.find(m => m.userId === 'designer-a').whatsapp, '+212611223344', 'member sees their own contact');
  ok(own.members.filter(m => m.userId !== a.userId).every(m => m.whatsapp === null), 'other members’ contacts are private');
  ok(!own.records.some(r => r.kind === 'meta'), 'contact metadata is never sent with task records');
  await post({ action: 'set-member-whatsapp', userId: 'designer-b', whatsapp: '+212600000002' }, 403);
  await post({ action: 'set-member-whatsapp', userId: 'designer-a', whatsapp: 'bad' }, 400);
  await post({ action: 'set-member-whatsapp', userId: 'designer-a', whatsapp: '06 11 22 33 44' });
  globalThis.testUser = owner;
  env.WHATSAPP_ASSIGNMENT_TEMPLATE = 'tache_assignee';
  env.WHATSAPP_ASSIGNMENT_LANGUAGE = 'fr';
  delete env.WHATSAPP_TEMPLATE; // assignment must not depend on approval setup
  const calls = sent.length;
  const created = await post({ action: 'create', kind: 'task', data: { name: 'Assigned design', clientId: client.id, due: '2027-03-01', assignee: 'Designer A' } });
  eq(created.assignmentWhatsapp.sent, true, 'new task assignment sends without the approval template');
  eq(sent.length, calls + 1, 'one assignment message');
  eq(sent.at(-1).body.to, '212611223344', 'to the assigned member, not the client');
  eq(sent.at(-1).body.template.components[0].parameters.map(p => p.text), ['Designer A', 'Assigned design', 'Owner', 'https://space.test/login'], 'four assignment body variables in the approved order');
  eq(sent.at(-1).body.template.name, 'tache_assignee', 'assignment uses its own approved template');
  let assigned = created.records.find(r => r.id === created.id);
  const edit = data => post({ action: 'update', kind: 'task', id: assigned.id, revision: assigned.revision, data: { name: assigned.name, clientId: assigned.clientId, due: assigned.due, status: assigned.status, assignee: assigned.assignee, ...data } });
  const unrelated = await edit({ description: 'New details' });
  assigned = unrelated.records.find(r => r.id === assigned.id);
  eq(sent.length, calls + 1, 'unrelated edits do not resend');
  const staleRevision = assigned.revision;
  const reassigned = await edit({ assignee: 'Designer B' });
  assigned = reassigned.records.find(r => r.id === assigned.id);
  eq(sent.at(-1).body.to, '212655667788', 'reassignment reaches only the new member');
  const countBeforeStale = sent.length;
  await post({ action: 'update', kind: 'task', id: assigned.id, revision: staleRevision, data: { name: assigned.name, clientId: client.id, due: assigned.due, assignee: 'Designer A' } }, 409);
  eq(sent.length, countBeforeStale, 'rejected concurrent write does not message anyone');
  const cleared = await edit({ assignee: '' });
  assigned = cleared.records.find(r => r.id === assigned.id);
  eq(sent.length, countBeforeStale, 'clearing an assignment does not send');
  const myself = await edit({ assignee: 'Owner' });
  assigned = myself.records.find(r => r.id === assigned.id);
  eq(sent.length, countBeforeStale, 'self-assignment does not send');
  delete env.WHATSAPP_ASSIGNMENT_TEMPLATE;
  const missing = await edit({ assignee: 'Designer A' });
  assigned = missing.records.find(r => r.id === assigned.id);
  eq(missing.assignmentWhatsapp.sent, false);
  ok(/WHATSAPP_ASSIGNMENT_TEMPLATE/.test(missing.assignmentWhatsapp.error), 'missing assignment template is actionable');
  eq(assigned.assigneeId, 'designer-a', 'notification failure preserves assignment');
  env.WHATSAPP_ASSIGNMENT_TEMPLATE = 'tache_assignee';
  await post({ action: 'set-member-whatsapp', userId: 'designer-b', whatsapp: '' });
  const noNumber = await edit({ assignee: 'Designer B' });
  eq(noNumber.assignmentWhatsapp.sent, false, 'enabled alerts report a missing member number');
  ok(/Équipe/.test(noNumber.assignmentWhatsapp.error), 'points to member profile');
  Object.assign(env, whatsappEnv);
  env.WHATSAPP_TEMPLATE_LANGUAGE = 'fr';
  // A 200 without a wamid is not a success; retry does not require a status toggle.
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://graph.facebook.com/')) { sent.push({ body: JSON.parse(init.body) }); return new Response('{}', { status: 200 }); }
    return realFetch(url, init);
  };
  const broken = await task(client.id, 'Empty Meta response');
  const brokenResult = await toApprove(broken, { name: 'Empty Meta response', clientId: client.id, due: '2027-03-01' });
  eq(brokenResult.whatsapp.sent, false, 'malformed acceptance is reported as failure');
  const waiting = brokenResult.records.find(r => r.id === broken.id);
  const retryBody = { action: 'retry-approval-whatsapp', taskId: waiting.id, revision: waiting.revision };
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://graph.facebook.com/')) { sent.push({ body: JSON.parse(init.body) }); return new Response('{"messages":[{"id":"wamid.RETRY"}]}', { status: 200 }); }
    return realFetch(url, init);
  };
  const retried = await post(retryBody);
  eq(retried.whatsapp.sent, true, 'retry succeeds once configuration/provider is repaired');
  eq(retried.records.find(r => r.id === waiting.id).revision, waiting.revision, 'retry preserves task status/revision');
  const retryCount = sent.length;
  await post(retryBody, 429);
  eq(sent.length, retryCount, 'duplicate retry sends nothing');
  globalThis.testUser = a;
  await post(retryBody, 403);
  globalThis.testUser = owner;
  ok(retried.records.some(r => r.whatsappMessageId === 'wamid.RETRY'), 'acceptance reference is available in the studio audit');
  // Separate creation paths also notify, without making their templates depend on approval.
  const request = await post({ action: 'request', clientId: client.id, data: { name: 'Requested visual' } });
  const beforeRequest = sent.length;
  const accepted = await post({ action: 'request-accept', id: request.id, data: { name: 'Accepted visual', assigneeId: 'designer-a' } });
  eq(accepted.assignmentWhatsapp.sent, true, 'accepted portal request sends an assignment notification');
  eq(sent.length, beforeRequest + 1, 'one message for accepting a request');

  await esbuild.build({ entryPoints: ['app/api/content-plan/route.ts'], outfile: '.sites-runtime/whatsapp-plan-test.mjs', bundle: true, platform: 'node', format: 'esm', plugins: [testRuntimePlugin({ auth: false })] });
  const { POST: planPost } = await import(pathToFileURL(process.cwd() + '/.sites-runtime/whatsapp-plan-test.mjs'));
  async function plan(body) {
    const response = await planPost(new Request('https://space.test/api/content-plan', { method: 'POST', headers: { 'Content-Type': 'application/json', origin: 'https://space.test', 'X-Workspace-Id': WS }, body: JSON.stringify(body) }));
    const result = await response.json(); eq(response.status, 200, JSON.stringify(result)); return result;
  }
  const createdPlan = (await plan({ action: 'create', clientId: client.id, month: '2027-03' })).plan;
  await plan({ action: 'update-plan', planId: createdPlan.id, revision: createdPlan.revision, patch: { branches: [{ id: 'launch', name: 'Launch' }] } });
  const idea = (await plan({ action: 'add-item', planId: createdPlan.id, name: 'Plan visual', planType: 'post', planBranch: 'launch' })).item;
  const beforePlan = sent.length;
  const assignedIdea = await plan({ action: 'update-item', itemId: idea.id, revision: idea.revision, patch: { assigneeId: 'designer-a' } });
  eq(assignedIdea.assignmentWhatsapp.sent, true, 'plan assignment notifies the member');
  eq(sent.length, beforePlan + 1, 'one message for assigning a plan idea');
  await plan({ action: 'update-item', itemId: idea.id, revision: assignedIdea.item.revision, patch: { planContent: 'New brief' } });
  eq(sent.length, beforePlan + 1, 'editing an assigned idea does not resend');
  await plan({ action: 'push', planId: createdPlan.id, itemIds: [idea.id] });
  eq(sent.length, beforePlan + 1, 'pushing an already assigned idea does not resend');
  const detail = await db.query('SELECT revision FROM records WHERE id = $1', [idea.id]);
  const approvalFromPlan = await plan({ action: 'update-item', itemId: idea.id, revision: detail[0].revision, patch: { status: 'À valider', deliverable: 'https://drive.test/file' } });
  eq(approvalFromPlan.whatsapp.sent, true, 'approval through the plan editor also notifies');

  // Removing someone from the team removes the WhatsApp contact stored for them.
  const withContact = await post({ action: 'invite-member', email: 'leaving@studio.test', name: 'Leaving Member', role: 'creative', whatsapp: '+212600000005' });
  const designerId = withContact.members.find((m) => m.email === 'leaving@studio.test').userId;
  ok((await db.query('SELECT id FROM records WHERE id = $1', [`whatsapp:${WS}:${designerId}`])).length === 1, 'the contact is stored with the membership');
  await post({ action: 'remove-member', userId: designerId, expectedRole: 'creative' });
  eq((await db.query('SELECT id FROM records WHERE id = $1', [`whatsapp:${WS}:${designerId}`])).length, 0, 'removing membership removes its contact metadata');

}

// Existing contacts may predate normalization. Every outbound template normalizes them too.
await esbuild.build({ entryPoints: ['lib/whatsapp.ts'], outfile: '.sites-runtime/whatsapp-sender-test.mjs', bundle: true, platform: 'node', format: 'esm', plugins: [testRuntimePlugin({ auth: false })] });
const { sendApprovalRequest, sendAssignmentNotice, sendMessageNotice } = await import(pathToFileURL(process.cwd() + '/.sites-runtime/whatsapp-sender-test.mjs'));
Object.assign(env, whatsappEnv, { WHATSAPP_TEMPLATE_LANGUAGE: 'fr', WHATSAPP_ASSIGNMENT_TEMPLATE: 'tache_assignee', WHATSAPP_ASSIGNMENT_LANGUAGE: 'fr', WHATSAPP_COMMENT_TEMPLATE: 'nouveau_message', WHATSAPP_COMMENT_LANGUAGE: 'fr' });
reply = { status: 200, body: { messages: [{ id: 'wamid.FORMAT' }] } };
for (const send of [sendApprovalRequest, sendAssignmentNotice, sendMessageNotice]) {
  const count = sent.length;
  eq((await send({ to: '06 12 34 56 78', clientName: 'Test client', memberName: 'Test member', from: 'Owner', taskName: 'Test task', url: 'https://space.test/login' })).sent, true, 'a legacy local contact can receive this template');
  eq(sent.length, count + 1, 'normalization sends once');
  eq(sent.at(-1).body.to, '212612345678', 'Meta receives the international digits without +');
}
const beforeInvalidSend = sent.length;
const invalidSend = await sendApprovalRequest({ to: '+212 6 12 34 56 780', clientName: 'Test', taskName: 'Test', url: 'https://space.test/login' });
eq(invalidSend.sent, false, 'an overlong stored contact is not sent to another recipient');
ok(/9 chiffres après \+212/.test(invalidSend.error), 'the sender returns the same useful length error');
eq(sent.length, beforeInvalidSend, 'invalid contact never reaches Meta');

globalThis.fetch = realFetch;
await pg.close();
console.log(`${checks} WhatsApp checks passed: template and variables, language, no number, Meta refusal, network failure, unconfigured, no resend, new-message notices.`);
