// The assistant « One » on Gemini (lib/agent.ts, lib/assistant-tools.ts, lib/assistant-memory.ts,
// app/api/assistant): answers stream line by line, the studio's assistant acts through /api/records with
// the person's own rights (create, update, comment), asks before lifting the J-7 lock, remembers what the
// studio teaches it, falls back to another model, and says plainly when Gemini fails. Gemini is stubbed:
// no call leaves the machine.
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
const records = await bundle('app/api/records/route.ts', 'agent-records.mjs');
const ai = await bundle('app/api/ai/route.ts', 'agent-ai.mjs');
const assistant = await bundle('app/api/assistant/route.ts', 'agent-assistant.mjs');

// ---- Gemini, stubbed: every request recorded; `script` answers turn by turn (parts, or an HTTP error).
const sent = [];
let script = [];
const realFetch = globalThis.fetch;
const sse = (parts, finish = 'STOP') => {
  const lines = parts.map((part, i) => `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [part] }, ...(i === parts.length - 1 ? { finishReason: finish } : {}) }] })}\r\n\r\n`);
  const encoder = new TextEncoder();
  return new ReadableStream({ start(c) { for (const l of lines) c.enqueue(encoder.encode(l)); c.close(); } });
};
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.startsWith('https://generativelanguage.googleapis.com/')) return realFetch(url, init);
  const model = decodeURIComponent(u.split('/models/')[1].split(':')[0]);
  sent.push({ url: u, model, body: JSON.parse(init.body), key: new Headers(init.headers).get('x-goog-api-key') });
  const next = script.shift() ?? [{ text: 'OK' }];
  const a = typeof next === 'function' ? next(model) : next;
  if (a.status) return new Response(JSON.stringify({ error: { code: a.status, message: a.message ?? 'boom', status: 'X' } }), { status: a.status, headers: { 'Content-Type': 'application/json' } });
  return new Response(sse(a.parts ?? a, a.finish), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
};

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const WS = 'ws:owner';
const B = 'https://space.test';
const owner = { userId: 'owner', fullName: 'Owner', displayName: 'Owner', email: 'owner@studio.test' };
const as = (user) => { globalThis.testUser = user; };
as(owner);
const headers = { 'Content-Type': 'application/json', origin: B, 'X-Workspace-Id': WS, cookie: 'session=abc' };
const post = async (body) => (await records.POST(new Request(`${B}/api/records`, { method: 'POST', headers, body: JSON.stringify(body) }))).json();
const row = async (id) => { const r = (await pg.query('SELECT data, revision FROM records WHERE id = $1', [id])).rows[0]; return r && { ...(typeof r.data === 'string' ? JSON.parse(r.data) : r.data), revision: r.revision }; };
const day = (n) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);

await records.GET(new Request(`${B}/api/records`));
const kojo = await post({ action: 'create', kind: 'client', data: { name: 'Kojo Bakery', language: 'Français' } });
const atlas = await post({ action: 'create', kind: 'client', data: { name: 'Atlas Café', language: 'Français' } });
const people = async (id, role, clientId = null) => {
  await pg.query('INSERT INTO users (id, name, email, password_hash) VALUES ($1, $1, $2, $3)', [id, `${id}@studio.test`, 'x']);
  await pg.query('INSERT INTO workspace_members (workspace_id, user_id, role, name, email, client_id) VALUES ($1, $2, $3, $2, $4, $5)', [WS, id, role, `${id}@studio.test`, clientId]);
  return { userId: id, fullName: id, displayName: id, email: `${id}@studio.test` };
};
const sara = await people('sara', 'creative');
const smm = await people('smm', 'social');
const admin = await people('admin', 'admin');
const operator = await people('operator', 'print_operator');
const viewer = await people('view', 'viewer');
const contact = await people('boss', 'client', kojo.id);

/** One question; the stream read back as its events. */
const ask = async (text, { status = 200, history = [] } = {}) => {
  const r = await assistant.POST(new Request(`${B}/api/assistant`, { method: 'POST', headers, body: JSON.stringify({ messages: [...history, { role: 'user', text }], page: 'tasks', locale: 'fr' }) }));
  assert.equal(r.status, status); checks++;
  if (r.headers.get('content-type')?.includes('application/json')) return r.json();
  ok(r.headers.get('content-type').startsWith('application/x-ndjson'), 'the answer is a stream of JSON lines');
  const events = (await r.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  eq(events.at(-1).type, 'done', 'the stream ends with done');
  return {
    events, text: events.filter((e) => e.type === 'text').map((e) => e.text).join(''),
    actions: events.filter((e) => e.type === 'action'), error: events.find((e) => e.type === 'error')?.error, changed: events.at(-1).changed,
  };
};
const memory = async (body) => {
  const r = body
    ? await assistant.POST(new Request(`${B}/api/assistant`, { method: 'POST', headers, body: JSON.stringify(body) }))
    : await assistant.GET(new Request(`${B}/api/assistant`, { headers }));
  return { status: r.status, ...(await r.json()) };
};
const call = (name, args, extra = {}) => ({ functionCall: { name, args }, ...extra });
const toolNames = (req) => (req.body.tools?.[0]?.functionDeclarations ?? []).map((t) => t.name).sort();
const system = (req) => req.body.systemInstruction.parts[0].text;

// 1. Off without any key; Gemini alone enables the assistant and writing help.
{
  eq((await ask('Salut', { status: 503 })).error, 'L’assistant n’est pas encore activé par le studio.', 'off until a key is set');
  env.GEMINI_API_KEY = 'gemini-test-key';
  eq(await (await ai.GET(new Request(`${B}/api/ai`))).json(), { configured: true, assistant: true }, 'Gemini alone enables the assistant and media-aware writing');
}

// 2. It streams: the words arrive as they are written, one event per piece.
{
  script = [[{ text: 'Bon' }, { text: 'jour ' }, { text: '**Owner**' }]];
  const a = await ask('Salut');
  eq(a.events.filter((e) => e.type === 'text').map((e) => e.text), ['Bon', 'jour ', '**Owner**'], 'three pieces, three events');
  eq(a.text, 'Bonjour **Owner**', 'the whole answer');
  const req = sent.at(-1);
  eq([req.key, req.model], ['gemini-test-key', 'gemini-flash-latest'], 'the key in the header, the current Flash model');
  ok(req.url.endsWith(':streamGenerateContent?alt=sse'), 'the streaming endpoint');
  eq(req.body.contents, [{ role: 'user', parts: [{ text: 'Salut' }] }], 'the conversation as Gemini turns');
  ok(/You ACT with your tools/.test(system(req)) && /\*\*One\*\*/.test(system(req)) && /<data>/.test(system(req)), 'it knows it acts, who it is, and the data');
  eq(toolNames(req), ['add_comment', 'create_task', 'forget', 'list_clients', 'list_team', 'remember', 'save_to_library', 'search_library', 'search_tasks', 'update_task'], 'the owner gets every tool');
  ok(!a.changed, 'nothing changed');
  eq(req.body.generationConfig.thinkingConfig, { thinkingLevel: 'low' }, 'it thinks lightly, so the first words come fast');
}

// 3. « Crée une tâche » → the task exists, made by /api/records with the person's rights.
let reel;
{
  script = [
    [{ text: 'Je crée la tâche.' }, call('create_task', { name: 'Reel ramadan', client: 'kojo', due: day(20), assignee: 'Sara', description: 'Menu du soir' }, { thoughtSignature: 'sig-1' })],
    [{ text: 'C’est fait : **Reel ramadan** pour Kojo Bakery.' }],
  ];
  const a = await ask('Crée une tâche Reel ramadan pour Kojo dans 20 jours, pour Sara');
  eq(a.actions.map((x) => [x.kind, x.name]), [['created', 'Reel ramadan']], 'an action card: task created');
  reel = a.actions[0].taskId;
  const task = await row(reel);
  eq([task.name, task.clientId, task.due, task.assignee, task.assigneeId, task.status, task.description], ['Reel ramadan', kojo.id, day(20), 'sara', 'sara', 'À faire', 'Menu du soir'], 'saved with the client, date, teammate and brief resolved from names');
  ok(task.history.some((h) => h.text === 'Élément créé'), 'with the usual history');
  eq(a.text, 'Je crée la tâche.\n\nC’est fait : **Reel ramadan** pour Kojo Bakery.', 'text before and after the action, as paragraphs');
  ok(a.changed, 'the page is told to refresh');
  eq(a.events.map((e) => (e.type === 'tool' ? `tool:${e.name}` : e.type)), ['text', 'tool:create_task', 'action', 'text', 'done'], 'the page hears what it is doing before the result');
  const [first, second] = sent.slice(-2);
  ok(first.body.tools && second.body.tools, 'tools on every round');
  eq(second.body.contents[1], { role: 'model', parts: [{ text: 'Je crée la tâche.' }, call('create_task', { name: 'Reel ramadan', client: 'kojo', due: day(20), assignee: 'Sara', description: 'Menu du soir' }, { thoughtSignature: 'sig-1' })] }, 'the model’s turn sent back as it came, thought signature included');
  const reply = second.body.contents[2];
  eq([reply.role, reply.parts[0].functionResponse.name, reply.parts[0].functionResponse.response.ok, reply.parts[0].functionResponse.response.task.id], ['user', 'create_task', true, reel], 'and the tool’s result');
  const events = (await pg.query("SELECT data FROM records WHERE kind = 'event' AND data->>'taskId' = $1", [reel])).rows.map((r) => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data));
  ok(events.some((e) => e.type === 'task-assigned' && e.recipients[0] === 'sara'), 'Sara is notified, as with a click');
}

// 4. Updates: status, date — only what was asked changes; ambiguous names come back as a question.
{
  const before = await row(reel);
  script = [[call('update_task', { task: reel, status: 'En cours', due: day(25) })], [{ text: 'Passée en cours.' }]];
  const a = await ask('Passe-la en cours et décale de 5 jours');
  const after = await row(reel);
  eq([after.status, after.due, after.assignee, after.description, after.revision], ['En cours', day(25), 'sara', 'Menu du soir', before.revision + 1], 'status and date changed, the rest kept');
  eq(a.actions.map((x) => [x.kind, x.detail]), [['updated', 'status, due']], 'an action card with what changed');

  await post({ action: 'create', kind: 'task', data: { name: 'Affiche été', clientId: atlas.id } });
  await post({ action: 'create', kind: 'task', data: { name: 'Affiche hiver', clientId: atlas.id } });
  script = [[call('update_task', { task: 'affiche', status: 'En pause' })], [{ text: 'Laquelle ?' }]];
  const b = await ask('Mets l’affiche en pause');
  const answer = sent.at(-1).body.contents.at(-1).parts[0].functionResponse.response;
  ok(/Plusieurs tâches correspondent/.test(answer.error) && /Affiche été/.test(answer.error) && /Affiche hiver/.test(answer.error), 'two matches: the model gets the choices');
  eq(b.actions, [], 'and nothing is done');

  script = [[call('search_tasks', { client: 'atlas' })], [{ text: 'Deux affiches.' }]];
  await ask('Quelles tâches pour Atlas ?');
  eq(sent.at(-1).body.contents.at(-1).parts[0].functionResponse.response.tasks.map((t) => t.name).sort(), ['Affiche hiver', 'Affiche été'], 'search finds by client');

  script = [[call('update_task', { task: reel, status: 'Validé' })], [{ text: 'Refusé.' }]];
  const c = await ask('Valide-la');
  eq(c.actions.map((x) => [x.kind, x.detail]), [['failed', 'Ajoutez un lien livrable avant la validation.']], 'the records rules apply: no validation without a deliverable, shown as not done');
  eq((await row(reel)).status, 'En cours', 'and nothing changed');
}

// 5. The J-7 lock: asked first, lifted only once the person confirmed.
{
  script = [[call('update_task', { task: reel, due: day(2) })], [{ text: 'C’est dans la semaine gelée : je lève le verrou ?' }]];
  const a = await ask('Avance-la à après-demain');
  const r = sent.at(-1).body.contents.at(-1).parts[0].functionResponse.response;
  ok(/Verrou J−7/.test(r.error) && /confirm_lock/.test(r.needs_confirmation), 'the lock comes back as a question for the person');
  eq([a.actions.length, (await row(reel)).due], [0, day(25)], 'nothing moved, no failure card');
  script = [[call('update_task', { task: reel, due: day(2), confirm_lock: true })], [{ text: 'Verrou levé.' }]];
  await ask('Oui, lève le verrou', { history: [{ role: 'user', text: 'Avance-la à après-demain' }, { role: 'model', text: 'Je lève le verrou ?' }] });
  const after = await row(reel);
  eq([after.due, after.lockOverride], [day(2), true], 'confirmed: moved, and the lift is recorded');
  ok(after.history.some((h) => /Verrou J−7 levé par Owner/.test(h.text)), 'in the history');
}

// 6. Comments, signed by the person.
{
  script = [[call('add_comment', { task: 'Reel ramadan', text: 'Merci de valider avant vendredi.' })], [{ text: 'Commentaire posté.' }]];
  const a = await ask('Écris au client de valider avant vendredi');
  eq(a.actions.map((x) => [x.kind, x.taskId]), [['commented', reel]], 'an action card');
  const c = (await pg.query("SELECT data FROM records WHERE kind = 'comment' AND data->>'taskId' = $1", [reel])).rows.map((r) => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data));
  eq(c.map((x) => [x.name, x.authorId]), [['Merci de valider avant vendredi.', 'owner']], 'in the thread, by the owner');
}

// 6b. The Bibliothèque: saved on request, found again.
{
  script = [[call('save_to_library', { name: 'Accroche Reel', category: 'prompt', content: 'Écris une accroche pour {client}.', tags: ['Reel'], tool: 'ChatGPT' })], [{ text: 'Ajouté.' }]];
  const a = await ask('Garde ce prompt dans la bibliothèque');
  eq(a.actions.map((x) => [x.kind, x.name]), [['saved', 'Accroche Reel']], 'saved, with a card');
  const saved = (await pg.query("SELECT data FROM records WHERE kind = 'library'")).rows.map((r) => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data));
  eq(saved.map((x) => [x.name, x.tool, x.tags, x.authorId]), [['Accroche Reel', 'ChatGPT', ['Reel'], 'owner']], 'in the library, by the owner');
  script = [[call('search_library', { query: 'accroche' })], [{ text: 'Voilà.' }]];
  await ask('Tu as un prompt d’accroche ?');
  eq(sent.at(-1).body.contents.at(-1).parts[0].functionResponse.response.entries.map((e) => [e.name, e.prompt]), [['Accroche Reel', 'Écris une accroche pour {client}.']], 'and found again, with its text');
}

// 7. Memory: taught in the chat or the panel, sent with every studio question, never to a client.
{
  script = [[call('remember', { fact: 'Kojo veut toujours ses légendes en darija.' })], [{ text: 'C’est noté.' }]];
  const a = await ask('Retiens que Kojo veut toujours ses légendes en darija');
  eq(a.actions.map((x) => [x.kind, x.name]), [['remembered', 'Kojo veut toujours ses légendes en darija.']], 'remembered, with a card');
  const m = await memory();
  eq([m.status, m.canTeach, m.facts.map((f) => [f.text, f.by])], [200, true, [['Kojo veut toujours ses légendes en darija.', 'Owner']]], 'the panel lists it, with who taught it');
  script = [[{ text: 'OK' }]];
  await ask('Une légende pour Kojo ?');
  ok(system(sent.at(-1)).includes(`[${m.facts[0].id}] Kojo veut toujours ses légendes en darija.`), 'every next question knows it');
  const added = await memory({ action: 'remember', text: '  Sara fait   les reels. ' });
  eq(added.facts.map((f) => f.text), ['Kojo veut toujours ses légendes en darija.', 'Sara fait les reels.'], 'taught from the panel, spaces tidied');
  eq((await memory({ action: 'remember', text: 'sara fait les reels.' })).facts.length, 2, 'the same fact twice is kept once');
  eq((await memory({ action: 'remember', text: 'x'.repeat(401) })).status, 400, 'a note stays short');

  // A direct API request or an unexpected model tool call cannot bypass the role restriction.
  for (const person of [sara, smm, viewer, operator, contact]) {
    as(person);
    const panel = await memory();
    if (person === contact) eq(panel.status, 403, 'a client cannot read studio memory');
    else eq([panel.status, panel.canTeach, panel.facts.length], [200, false, 2], `${person.userId} can read but cannot teach`);
    eq((await memory({ action: 'remember', text: 'Forbidden rule.' })).status, 403, `${person.userId} cannot add memory through the API`);
    eq((await memory({ action: 'forget', id: m.facts[0].id })).status, 403, `${person.userId} cannot delete memory through the API`);
    script = [[call('remember', { fact: 'Forbidden rule.' }), call('forget', { id: m.facts[0].id })], [{ text: 'Refusé.' }]];
    const denied = await ask('Retiens cette règle et oublie la précédente');
    eq([denied.actions.length, denied.changed], [0, false], `${person.userId}: refused model calls make no changes`);
    const request = sent.at(-1);
    ok(!toolNames(request).includes('remember') && !toolNames(request).includes('forget'), `${person.userId}: memory tools are never offered`);
    ok(request.body.contents.at(-1).parts.every((p) => p.functionResponse.response.error), `${person.userId}: both direct tool calls are refused`);
  }
  as(admin);
  const s = await memory();
  eq([s.status, s.canTeach, s.facts.length], [200, true, 2], 'only the owner and administrators can teach; denied attempts left facts intact');
  eq((await memory({ action: 'remember', text: 'Publier le mardi à 19h.' })).facts.length, 3, 'an administrator teaches from the panel');
  script = [[call('remember', { fact: 'Temporary administrator note.' })], [{ text: 'Noté.' }]];
  eq((await ask('Retiens cette note temporaire')).actions.map((x) => x.kind), ['remembered'], 'an administrator teaches through chat');
  const temp = (await memory()).facts.find((f) => f.text === 'Temporary administrator note.');
  script = [[call('forget', { id: temp.id })], [{ text: 'Oublié.' }]];
  eq((await ask('Oublie la note temporaire')).actions.map((x) => x.kind), ['forgot'], 'an administrator forgets through chat');
  const panelTemp = await memory({ action: 'remember', text: 'Temporary panel note.' });
  eq((await memory({ action: 'forget', id: panelTemp.facts.at(-1).id })).facts.length, 3, 'an administrator deletes from the panel');
  as(contact);
  eq((await memory()).status, 403, 'a client never reads it');
  script = [[{ text: 'Bonjour' }]];
  await ask('Bonjour');
  const req = sent.at(-1);
  ok(!req.body.tools && !/darija\./.test(system(req)) && !/What the studio taught you/.test(system(req)), 'a client: no tools, no memory');
  ok(/You don't act — you prepare/.test(system(req)), 'a client’s assistant explains and points to the buttons');
  as(owner);
  script = [[call('forget', { id: s.facts[1].id })], [{ text: 'Oublié.' }]];
  const f = await ask('Oublie la note sur Sara');
  eq(f.actions.map((x) => x.kind), ['forgot'], 'forgotten from the chat');
  eq((await memory()).facts.map((x) => x.text), ['Kojo veut toujours ses légendes en darija.', 'Publier le mardi à 19h.'], 'gone from the list');
}

// 8. Each role its own reach: a creative moves their own work, never creates or renames; a viewer searches.
{
  const other = await post({ action: 'create', kind: 'task', data: { name: 'Carrousel Atlas', clientId: atlas.id, assignee: 'smm' } });
  as(sara);
  script = [[{ text: 'OK' }]];
  await ask('Salut');
  eq(toolNames(sent.at(-1)), ['add_comment', 'list_clients', 'list_team', 'save_to_library', 'search_library', 'search_tasks', 'update_task'], 'a creative: no creating tasks, no memory');
  script = [[call('update_task', { task: other.id, status: 'En cours' })], [{ text: 'Introuvable.' }]];
  const a = await ask('Passe le carrousel Atlas en cours');
  ok(/Aucun\(e\) tâche/.test(sent.at(-1).body.contents.at(-1).parts[0].functionResponse.response.error), 'a colleague’s task is out of reach');
  eq([a.actions.length, (await row(other.id)).status], [0, 'À faire'], 'untouched');
  script = [[call('update_task', { task: 'Reel ramadan', name: 'Reel ramadan v2' })], [{ text: 'Refusé.' }]];
  const b = await ask('Renomme mon reel');
  eq(b.actions.map((x) => [x.kind, x.detail]), [['failed', 'Un membre ne peut modifier que le lien livrable et le statut de cette tâche.']], 'a creative cannot rename');
  script = [[call('update_task', { task: 'Reel ramadan', deliverable: 'https://drive.google.com/file/d/abc' })], [{ text: 'Envoyé au client.' }]];
  const c = await ask('Voici le lien du reel : https://drive.google.com/file/d/abc');
  const sentTask = await row(reel);
  eq([c.actions[0].kind, sentTask.status, sentTask.deliverable], ['updated', 'À valider', 'https://drive.google.com/file/d/abc'], 'but their deliverable link sends it for validation, as in the app');
  ok(sentTask.approvalDueAt, 'with the 48 h clock started');
  as(viewer);
  script = [[{ text: 'OK' }]];
  await ask('Salut');
  eq(toolNames(sent.at(-1)), ['list_clients', 'list_team', 'search_library', 'search_tasks'], 'a viewer only looks');
  as(owner);
}

// 9. A model that does not exist → the next one, remembered; failures say why.
{
  env.GEMINI_MODEL = 'gemini-nope';
  const n = sent.length;
  script = [{ status: 404, message: 'models/gemini-nope is not found' }, [{ text: 'Me voilà' }]];
  eq((await ask('Salut')).text, 'Me voilà', 'the answer comes from the next model');
  eq(sent.slice(n).map((r) => r.model), ['gemini-nope', 'gemini-flash-latest'], 'tried in order');
  script = [[{ text: 'Encore' }]];
  await ask('Salut');
  eq(sent.at(-1).model, 'gemini-flash-latest', 'the model that works is asked first next time');
  delete env.GEMINI_MODEL;

  env.GEMINI_THINKING = 'minimal';
  script = [[{ text: 'Vite' }]];
  await ask('Salut');
  eq(sent.at(-1).body.generationConfig.thinkingConfig, { thinkingLevel: 'minimal' }, 'GEMINI_THINKING changes how long it thinks');
  env.GEMINI_THINKING = 'forever';
  script = [[{ text: 'Vite' }]];
  await ask('Salut');
  eq(sent.at(-1).body.generationConfig.thinkingConfig, { thinkingLevel: 'low' }, 'an unknown value keeps the default');
  delete env.GEMINI_THINKING;
  const n3 = sent.length;
  script = [{ status: 400, message: 'Thinking level is not supported for this model.' }, [{ text: 'Sans réflexion' }]];
  eq((await ask('Salut')).text, 'Sans réflexion', 'a model without the thinking setting is asked again without it');
  eq([sent.slice(n3).map((r) => r.model), !!sent.at(-2).body.generationConfig.thinkingConfig, sent.at(-1).body.generationConfig.thinkingConfig], [['gemini-flash-latest', 'gemini-flash-latest'], true, undefined], 'same model, the setting dropped');

  script = [{ status: 403, message: 'API key not valid' }];
  eq((await ask('Salut')).error, 'Clé de l’IA refusée (GEMINI_API_KEY).', 'a refused key is said as such, no other model tried');
  let n2 = sent.length;
  script = [{ status: 503, message: 'This model is currently experiencing high demand.' }, [{ text: 'Me revoilà' }]];
  eq((await ask('Salut')).text, 'Me revoilà', 'an overloaded model is tried once more, a moment later');
  eq(sent.slice(n2).map((r) => r.model), ['gemini-flash-latest', 'gemini-flash-latest'], 'the same model, twice');
  n2 = sent.length;
  script = [{ status: 503 }, { status: 503 }, { status: 404, message: 'This model models/gemini-3.8-flash is no longer available to new users.' }, [{ text: 'Lite' }]];
  eq((await ask('Salut')).text, 'Lite', 'still overloaded, the next model closed to this key: the Flash-Lite pool answers');
  eq(sent.slice(n2).map((r) => r.model), ['gemini-flash-latest', 'gemini-flash-latest', 'gemini-3.8-flash', 'gemini-flash-lite-latest'], 'in that order');
  script = [{ status: 503 }, { status: 503 }, { status: 503 }, { status: 503 }];
  eq((await ask('Salut')).error, 'L’IA ne répond pas pour le moment. Réessayez.', 'every model down: a clear error');
  script = [{ status: 429 }, { status: 429 }];
  eq((await ask('Salut')).error, 'L’IA est très demandée : réessayez dans un instant.', 'out of quota: said so');
  // Gemini down but Groq set up: Groq answers, without actions.
  env.GROQ_API_KEY = 'groq-test-key';
  const groq = [];
  const gemini = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (!String(url).startsWith('https://api.groq.com/')) return gemini(url, init);
    groq.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Réponse de secours' }, finish_reason: 'stop' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  script = [{ status: 503 }, { status: 503 }, { status: 503 }, { status: 503 }];
  const g = await ask('Salut');
  eq([g.text, g.error], ['Réponse de secours', undefined], 'Gemini down: Groq answers instead of an error');
  ok(/You don't act — you prepare/.test(groq[0].messages[0].content), 'and it knows it cannot act');
  script = [{ status: 403, message: 'API key not valid' }];
  eq((await ask('Salut')).error, 'Clé de l’IA refusée (GEMINI_API_KEY).', 'a refused key is still said, not hidden behind Groq');
  globalThis.fetch = gemini;
  delete env.GROQ_API_KEY;
  script = [{ parts: [{ text: '' }], finish: 'SAFETY' }];
  eq((await ask('Salut')).error, 'L’IA n’a pas pu traiter ce contenu.', 'a blocked answer');
}

// 10. No waiting: many questions in a row, all answered; the conversation's rules still hold.
{
  for (let i = 0; i < 25; i++) { script = [[{ text: `r${i}` }]]; eq((await ask(`q${i}`)).text, `r${i}`, `question ${i + 1} answered at once`); }
  eq((await ask('', { status: 400 })).error, 'Posez votre question.', 'an empty question');
  script = [[call('search_tasks', {})], [call('search_tasks', {})], [call('search_tasks', {})], [call('search_tasks', {})], [call('search_tasks', {})], [{ text: 'Voilà.' }]];
  const a = await ask('Cherche partout');
  eq(a.text, 'Voilà.', 'after five rounds of tools it must answer');
  ok(!sent.at(-1).body.tools, 'the last round has no tools');
  as(null);
  eq((await ask('Salut', { status: 401 })).error, 'Connexion requise.', 'signed out');
  as(owner);
}

globalThis.fetch = realFetch;
await pg.close();
console.log(`${checks} agent checks passed: streaming, create/update/comment through the records rules, the J-7 lock asked first, memory taught and forgotten, each role its tools, model fallback and errors, no waiting.`);
