// Writing help with Claude (app/api/ai, lib/ai.ts): who may ask, what is sent to Claude (the brand
// and its language from the client file, never the browser's word), what comes back, refusals, errors
// and the per-person limit. Claude is stubbed: no call leaves the machine.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';

const esbuildPath = globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0] || 'node_modules/esbuild/lib/main.js';
const esbuild = await import(pathToFileURL(esbuildPath));
mkdirSync('.sites-runtime', { recursive: true });
const { db, pg } = await createTestDb();
globalThis.testDb = db;
const env = { OWNER_EMAIL: 'owner@studio.test', AUTH_URL: 'https://space.test' };
globalThis.testEnv = env;
const bundle = async (entry, out) => {
  await esbuild.build({ entryPoints: [entry], outfile: `.sites-runtime/${out}`, bundle: true, platform: 'node', format: 'esm', plugins: [testRuntimePlugin({ auth: false })] });
  return import(pathToFileURL(`${process.cwd()}/.sites-runtime/${out}`));
};
const records = await bundle('app/api/records/route.ts', 'ai-records.mjs');
const ai = await bundle('app/api/ai/route.ts', 'ai-route.mjs');

// ---- Claude, stubbed: each request recorded, the answer scripted per test.
const sent = [];
let answer = () => ({ text: JSON.stringify({ text: 'Bonjour !' }) });
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.startsWith('https://api.anthropic.com/')) return realFetch(url, init);
  const headers = new Headers(init.headers);
  const body = JSON.parse(init.body);
  sent.push({ url: u, body, beta: headers.get('anthropic-beta'), key: headers.get('x-api-key') });
  const a = answer(body);
  if (a.status) return new Response(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'boom' } }), { status: a.status, headers: { 'Content-Type': 'application/json' } });
  return new Response(JSON.stringify({
    id: 'msg_1', type: 'message', role: 'assistant', model: body.model, stop_reason: a.stop || 'end_turn', stop_sequence: null,
    content: a.stop === 'refusal' ? [] : [{ type: 'text', text: a.text }], usage: { input_tokens: 10, output_tokens: 10 },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const WS = 'ws:owner';
const B = 'https://space.test';
const owner = { userId: 'owner', fullName: 'Owner', displayName: 'Owner', email: 'owner@studio.test' };
const as = (user) => { globalThis.testUser = user; };
as(owner);
const ask = async (body, status = 200) => {
  const r = await ai.POST(new Request(`${B}/api/ai`, { method: 'POST', headers: { 'Content-Type': 'application/json', origin: B, 'X-Workspace-Id': WS }, body: JSON.stringify(body) }));
  const d = await r.json(); assert.equal(r.status, status, JSON.stringify(d)); checks++; return d;
};
const post = async (body) => {
  const r = await records.POST(new Request(`${B}/api/records`, { method: 'POST', headers: { 'Content-Type': 'application/json', origin: B, 'X-Workspace-Id': WS }, body: JSON.stringify(body) }));
  return r.json();
};

await records.GET(new Request(`${B}/api/records`));
const client = await post({ action: 'create', kind: 'client', data: { name: 'Kojo Bakery', language: 'Français' } });
assert.ok(client.id, JSON.stringify(client));
const arabic = await post({ action: 'create', kind: 'client', data: { name: 'مخبز', language: 'العربية' } });
const people = async (id, role, clientId = null) => {
  await pg.query('INSERT INTO users (id, name, email, password_hash) VALUES ($1, $1, $2, $3)', [id, `${id}@studio.test`, 'x']);
  await pg.query('INSERT INTO workspace_members (workspace_id, user_id, role, name, email, client_id) VALUES ($1, $2, $3, $2, $4, $5)', [WS, id, role, `${id}@studio.test`, clientId]);
  return { userId: id, fullName: id, displayName: id, email: `${id}@studio.test` };
};
const creative = await people('crea', 'creative');
const smm = await people('smm', 'social');
const viewer = await people('view', 'viewer');
const contact = await people('boss', 'client', client.id);

// 1. Not set up: the buttons stay hidden and a call says why.
{
  eq(await (await ai.GET(new Request(`${B}/api/ai`))).json(), { configured: false }, 'the page learns the AI is off');
  eq((await ask({ action: 'correct', kind: 'task', text: 'bonjour' }, 503)).error, 'L’IA n’est pas configurée pour cet espace (ANTHROPIC_API_KEY).', 'a call says what is missing');
  eq(sent.length, 0, 'and Claude is never called');
  env.ANTHROPIC_API_KEY = 'sk-ant-test';
  eq(await (await ai.GET(new Request(`${B}/api/ai`))).json(), { configured: true }, 'set up: the buttons show');
  as(null);
  eq((await ai.GET(new Request(`${B}/api/ai`))).status, 401, 'never for someone signed out');
  as(owner);
}

// 2. Correcting a task's text: the text goes to Claude with the proofreading instructions, the fix comes back.
{
  answer = () => ({ text: JSON.stringify({ text: 'Refaire la bannière de la page d’accueil' }) });
  const d = await ask({ action: 'correct', kind: 'task', text: 'refair la baniere de la page d acceuil' });
  eq(d, { text: 'Refaire la bannière de la page d’accueil', changed: true }, 'the corrected text, marked as changed');
  const req = sent.at(-1);
  eq([req.body.model, req.body.fallbacks, req.key], ['claude-opus-5', 'default', 'sk-ant-test'], 'Claude Opus 5, with the recommended fallback, with the studio’s key');
  ok(req.beta.includes('server-side-fallback-2026-07-01'), 'the fallback beta is switched on');
  ok(req.body.messages[0].content.includes('refair la baniere') && /task name/.test(req.body.system), 'the text and what kind of text it is');
  eq(req.body.output_config.format.type, 'json_schema', 'the answer comes back as structured JSON');
  answer = (body) => ({ text: JSON.stringify({ text: body.messages[0].content.split('\n')[2] }) });
  eq((await ask({ action: 'correct', kind: 'brief', text: 'Déjà parfait.' })).changed, false, 'a correct text comes back unchanged');
  await ask({ action: 'correct', kind: 'task', text: '   ' }, 400);
  await ask({ action: 'correct', kind: 'nope', text: 'x' }, 400);
}

// 3. Who may ask: the studio's writers correct; captions are for those who run the Social hub.
{
  answer = () => ({ text: JSON.stringify({ text: 'Corrigé.' }) });
  as(creative);
  await ask({ action: 'correct', kind: 'feedback', text: 'a corigé' });
  eq((await ask({ action: 'caption', network: 'instagram', format: 'post', brief: 'x' }, 403)).error, 'Le Social est réservé au propriétaire, aux administrateurs et aux social media managers.', 'a « Membre » corrects but does not write captions');
  as(viewer);
  await ask({ action: 'correct', kind: 'task', text: 'x' }, 403);
  as(contact);
  await ask({ action: 'correct', kind: 'task', text: 'x' }, 403);
  as(owner);
  const cross = await ai.POST(new Request(`${B}/api/ai`, { method: 'POST', headers: { 'Content-Type': 'application/json', origin: 'https://evil.test', 'X-Workspace-Id': WS }, body: '{"action":"correct","kind":"task","text":"x"}' }));
  eq(cross.status, 403, 'Origin is checked');
}

// 4. Captions: three proposals and a title, written for the network, in the client's own language.
{
  as(smm);
  answer = () => ({ text: JSON.stringify({ captions: ['Fresh croissants 🥐 #bakery', 'Every morning at 5am…', 'Order yours today!', 'a fourth one'], title: 'Autumn croissants' }) });
  const d = await ask({ action: 'caption', network: 'instagram', format: 'reel', clientId: client.id, brief: 'Croissants d’automne', current: '', media: { images: 0, videos: 1 }, language: 'العربية' });
  eq(d, { captions: ['Fresh croissants 🥐 #bakery', 'Every morning at 5am…', 'Order yours today!'], title: 'Autumn croissants' }, 'three captions at most, and a title');
  const req = sent.at(-1);
  ok(/Write in French/.test(req.body.system) && /Instagram Reel/.test(req.body.system), 'in the client file’s language (not the browser’s), for an Instagram Reel');
  ok(req.body.messages[0].content.includes('Brand: Kojo Bakery') && req.body.messages[0].content.includes('0 photo(s), 1 video(s)'), 'with the brand and the media');
  await ask({ action: 'caption', network: 'facebook', format: 'post', clientId: arabic.id, brief: 'Pain' });
  ok(/Write in Arabic/.test(sent.at(-1).body.system), 'an Arabic client gets Arabic');
  await ask({ action: 'caption', network: 'internal', format: 'post', clientId: 'internal', brief: 'Portfolio' }, 400);
  await ask({ action: 'caption', network: 'instagram', format: 'post', clientId: 'internal', brief: 'Portfolio' });
  ok(/Write in French/.test(sent.at(-1).body.system) && !sent.at(-1).body.messages[0].content.includes('Brand:'), 'the studio’s own posts: French, no client brand');
  await ask({ action: 'caption', network: 'tiktok', format: 'carousel', brief: 'x' }, 400);
  await ask({ action: 'caption', network: 'instagram', format: 'post', brief: '', current: '' }, 400);
}

// 5. YouTube titles: three at most, no hashtags, within YouTube's limit.
{
  answer = () => ({ text: JSON.stringify({ titles: ['La recette du croissant #shorts', 'x'.repeat(140)] }) });
  const d = await ask({ action: 'title', format: 'short', clientId: client.id, brief: 'Recette', current: 'On vous montre tout.' });
  eq(d.titles, ['La recette du croissant', 'x'.repeat(100)], 'hashtags removed, cut to 100 characters');
  ok(/Shorts/.test(sent.at(-1).body.system), 'written for a Short');
}

// 6. When Claude declines or fails, the button says so; nothing is invented.
{
  answer = () => ({ stop: 'refusal' });
  eq((await ask({ action: 'correct', kind: 'task', text: 'x' }, 502)).error, 'L’IA n’a pas pu traiter ce texte.', 'a refusal is reported');
  answer = () => ({ status: 500 });
  eq((await ask({ action: 'correct', kind: 'task', text: 'x' }, 502)).error, 'L’IA ne répond pas pour le moment. Réessayez.', 'a Claude error is reported');
  answer = () => ({ status: 401 });
  eq((await ask({ action: 'correct', kind: 'task', text: 'x' }, 502)).error, 'Clé de l’IA refusée (ANTHROPIC_API_KEY).', 'a refused key says so');
}

// 7. A handful of calls a minute per person.
{
  answer = () => ({ text: JSON.stringify({ text: 'ok' }) });
  as(await people('busy', 'admin'));
  for (let i = 0; i < 20; i++) await ask({ action: 'correct', kind: 'task', text: `t${i}` });
  eq((await ask({ action: 'correct', kind: 'task', text: 'one more' }, 429)).error, 'Trop de demandes : patientez une minute.', 'the 21st call in a minute waits');
  as(owner);
  await ask({ action: 'correct', kind: 'task', text: 'someone else' });
}

globalThis.fetch = realFetch;
await pg.close();
console.log(`${checks} AI checks passed: not configured, corrections, who may ask, captions in the client’s language, YouTube titles, refusals and errors, per-person limit.`);
