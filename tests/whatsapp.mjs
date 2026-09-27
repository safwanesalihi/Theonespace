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
async function post(body, status = 200) {
  const r = await POST(new Request('https://space.test/api/records', { method: 'POST', headers: { 'Content-Type': 'application/json', origin: 'https://space.test', 'X-Workspace-Id': WS }, body: JSON.stringify(body) }));
  const d = await r.json(); assert.equal(r.status, status, JSON.stringify(d)); checks++; return d;
}
await GET(new Request('https://space.test/api/records'));

// The number is validated on the client file, and accepted as a person would type it.
await post({ action: 'create', kind: 'client', data: { name: 'Mauvais numéro', whatsapp: '0612345678' } }, 400);
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
eq(m.body.template.components[0].parameters.map((p) => p.text), ['Kojo Bakery', 'Reel de lancement', 'https://space.test'], '{{1}} client, {{2}} deliverable, {{3}} portal address');
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
ok(!('whatsapp' in r3), 'and nothing about WhatsApp in the reply');

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
ok(!('whatsapp' in r6), 'and nothing in the reply');

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
  const said = await post({ action: 'comment', taskId: chatTask.id, text: 'Et la seconde version.' });
  eq(sent.length, before + 1, 'with it, the client hears about the message');
  const notice = sent.at(-1).body;
  eq([notice.template.name, notice.template.language.code, notice.to], ['nouveau_message', 'fr', '212612345678'], 'the message template, in French, to the client’s number');
  eq(notice.template.components[0].parameters.map((p) => p.text), ['Kojo Bakery', 'Owner', 'Carrousel soldes', 'https://space.test'], 'client, who wrote, the task, the portal');
  ok(said.records.some((r) => r.kind === 'event' && r.type === 'whatsapp' && r.taskId === chatTask.id && r.name.startsWith('WhatsApp envoyé')), 'the studio sees it went out');
  await post({ action: 'comment', taskId: chatTask.id, text: 'Encore une précision.' });
  eq(sent.length, before + 1, 'not again within two hours on the same task');
  const other = await task(silent.id, 'Sans numéro');
  await post({ action: 'comment', taskId: other.id, text: 'Bonjour' });
  eq(sent.length, before + 1, 'a client without a number gets nothing');
  delete env.WHATSAPP_COMMENT_TEMPLATE;
}

globalThis.fetch = realFetch;
await pg.close();
console.log(`${checks} WhatsApp checks passed: template and variables, language, no number, Meta refusal, network failure, unconfigured, no resend, new-message notices.`);
