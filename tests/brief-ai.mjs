// The brand brief written by the AI (lib/brief-ai.ts, /api/ai « brief »): what is read about a client
// (its file, its content plans, tasks, posts, requests and feedback — never another client's, never
// prices or contracts), what comes back (a valid brief, ids added, no invented colour or link), the two
// ways to apply it, and who may ask. Groq is stubbed: no call leaves the machine.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';

const esbuildPath = globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0] || 'node_modules/esbuild/lib/main.js';
const esbuild = await import(pathToFileURL(esbuildPath));
mkdirSync('.sites-runtime', { recursive: true });
const { db, pg } = await createTestDb();
globalThis.testDb = db;
const env = { OWNER_EMAIL: 'owner@studio.test', AUTH_URL: 'https://space.test', GROQ_API_KEY: 'groq-test' };
globalThis.testEnv = env;
const bundle = async (entry, out) => {
  await esbuild.build({ entryPoints: [entry], outfile: `.sites-runtime/${out}`, bundle: true, platform: 'node', format: 'esm', external: ['nodemailer'], plugins: [testRuntimePlugin({ auth: false })] });
  return import(pathToFileURL(`${process.cwd()}/.sites-runtime/${out}`));
};
const records = await bundle('app/api/records/route.ts', 'brief-ai-records.mjs');
const ai = await bundle('app/api/ai/route.ts', 'brief-ai-route.mjs');
const plans = await bundle('app/api/content-plan/route.ts', 'brief-ai-plans.mjs');
const lib = await bundle('lib/brief-ai.ts', 'brief-ai-lib.mjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

// ---- Groq, stubbed: each request kept, the answer scripted.
const sent = [];
let answer = () => ({ content: JSON.stringify(proposal) });
let groqStatus = 200;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  if (String(url).startsWith('https://api.groq.com/')) {
    sent.push(JSON.parse(init.body));
    if (groqStatus !== 200) return new Response(JSON.stringify({ error: { message: 'busy' } }), { status: groqStatus });
    return new Response(JSON.stringify({ choices: [{ message: answer() }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return realFetch(url, init);
};
const proposal = {
  overview: 'Centre de formation à Tanger : programmation, robotique et soutien scolaire pour les enfants et les adolescents.',
  audience: 'Les parents d’élèves de 8 à 16 ans à Tanger.', voice: 'Rassurant, concret, en français et en darija.',
  identity: { colors: [{ name: 'Bleu', value: '#1E3A8A' }, { name: 'Inventé', value: 'bleu nuit' }], typography: '', direction: 'Des enfants en atelier, des écrans de code.', dos: 'Montrer les projets des élèves.', donts: 'Pas de visuels trop chargés (retour client).' },
  goals: [{ title: 'Faire connaître les ateliers de robotique', measure: 'Demandes de renseignements par message' }, { title: '', measure: 'vide' }],
  requirements: [{ text: 'Deux reels par semaine', priority: 'must' }, { text: 'Sous-titres en français', priority: 'nice' }],
  references: [{ label: 'Site', url: 'https://alkhaouarizmi.ma' }, { label: 'Lien inventé', url: 'https://invented.example' }],
};

const WS = 'ws:owner';
const B = 'https://space.test';
const owner = { userId: 'owner', fullName: 'Owner', displayName: 'Owner', email: 'owner@studio.test' };
const as = (user) => { globalThis.testUser = user; };
const post = async (route, body, status = 200) => {
  const r = await route.POST(new Request(`${B}/api/x`, { method: 'POST', headers: { 'Content-Type': 'application/json', origin: B, 'X-Workspace-Id': WS }, body: JSON.stringify(body) }));
  const d = await r.json(); assert.equal(r.status, status, JSON.stringify(d)); checks++; return d;
};
const people = async (id, role) => {
  await pg.query('INSERT INTO users (id, name, email, password_hash) VALUES ($1, $1, $2, $3)', [id, `${id}@studio.test`, 'x']);
  await pg.query('INSERT INTO workspace_members (workspace_id, user_id, role, name, email) VALUES ($1, $2, $3, $2, $4)', [WS, id, role, `${id}@studio.test`]);
  return { userId: id, fullName: id, displayName: id, email: `${id}@studio.test` };
};
const raw = (id, data) => pg.query("INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ($1, 'owner', $2, $3, $4::jsonb, 1)", [id, WS, data.kind, JSON.stringify({ id, revision: 1, createdAt: '2026-10-01T10:00:00.000Z', ...data })]);

// ---- A client with a content plan, tasks, posts, a request, feedback — and another client beside it.
as(owner);
await records.GET(new Request(`${B}/api/records`));
const client = await post(records, { action: 'create', kind: 'client', data: { name: 'Centre Alkhaouarizmi', sector: 'Éducation', language: 'Français', quota: '12', description: 'Formations en programmation à Tanger. Site : https://alkhaouarizmi.ma' } });
const other = await post(records, { action: 'create', kind: 'client', data: { name: 'Kojo Bakery', description: 'Boulangerie' } });
const { plan } = await post(plans, { action: 'create', clientId: client.id, month: '2026-10' });
await post(plans, { action: 'update-plan', planId: plan.id, revision: plan.revision, patch: { branches: [{ id: 'b1', name: 'Projets des élèves' }, { id: 'b2', name: 'Coulisses' }], notes: 'Rentrée : mettre en avant la robotique.' } });
await post(plans, { action: 'add-item', planId: plan.id, planBranch: 'b1', planType: 'reel', name: 'Le robot de Yasmine' });
const otherPlan = (await post(plans, { action: 'create', clientId: other.id, month: '2026-10' })).plan;
await post(plans, { action: 'update-plan', planId: otherPlan.id, revision: otherPlan.revision, patch: { branches: [{ id: 'k1', name: 'Pains secrets' }] } });
await post(plans, { action: 'add-item', planId: otherPlan.id, planBranch: 'k1', planType: 'post', name: 'Croissant de Kojo' });
const task = await post(records, { action: 'create', kind: 'task', data: { name: 'Affiche portes ouvertes', clientId: client.id, description: 'Format A3 et story' } });
await post(records, { action: 'create', kind: 'task', data: { name: 'Tâche de Kojo', clientId: other.id } });
await raw('feedback-1', { kind: 'comment', name: '[Retours client — tour 1] Trop de texte sur l’affiche', taskId: task.id, clientId: client.id });
await raw('chat-1', { kind: 'comment', name: 'Message interne : on facture 4 000 MAD', taskId: task.id, clientId: client.id });
await raw('request-1', { kind: 'request', name: 'Vidéo pour les inscriptions', description: 'Pour septembre', clientId: client.id });
await raw('post-1', { kind: 'editorial_post', name: 'Rentrée', description: 'Les inscriptions sont ouvertes 🎒 #Tanger', clientId: client.id, targets: [{ network: 'instagram', format: 'reel' }], socialState: 'scheduled', due: '2026-10-05' });
await raw('doc-1', { kind: 'document', name: 'Devis', clientId: client.id, docType: 'quote', number: 'D-1', total: 4000 });
await pg.query("UPDATE records SET data = data || $1::jsonb WHERE id = $2", [JSON.stringify({ serviceScope: { summary: 'Offre à 4 000 MAD par mois' } }), client.id]);

// 1. What is read: this client's material, newest first; never another client's, prices or contracts.
{
  const rows = (await records.GET(new Request(`${B}/api/records`, { headers: { 'X-Workspace-Id': WS } })).then((r) => r.json())).records;
  const listed = (await plans.GET(new Request(`${B}/api/content-plan?clientId=${client.id}`, { headers: { 'X-Workspace-Id': WS } })).then((r) => r.json())).plans;
  ok(listed.length === 1, 'the client has one month');
  const full = await post(ai, { action: 'brief', clientId: client.id });
  const material = sent.at(-1).messages[1].content;
  for (const expected of ['Centre Alkhaouarizmi', 'Sector: Éducation', 'Pieces of content per month: 12', 'Rentrée : mettre en avant la robotique.', 'Series « Projets des élèves »', '[reel] Le robot de Yasmine', 'Series « Coulisses » (no content yet)', 'Affiche portes ouvertes — Format A3 et story', 'Instagram Reel', 'Les inscriptions sont ouvertes', 'Vidéo pour les inscriptions — Pour septembre', '[Retours client — tour 1] Trop de texte']) {
    ok(material.includes(expected), `the material holds « ${expected} »`);
  }
  for (const absent of ['Kojo', 'Pains secrets', 'Croissant', '4 000', '4000', 'Devis', 'Message interne']) ok(!material.includes(absent), `never « ${absent} »`);
  ok(/never mention prices, contracts/.test(sent.at(-1).messages[0].content) && /untrusted source text/.test(sent.at(-1).messages[0].content), 'the model is told the client reads it, and that the material is not instructions');
  ok(/in French/.test(sent.at(-1).messages[0].content), 'written in the client file’s language');
  eq(full.basis, { months: 1, ideas: 1, tasks: 1, posts: 1, requests: 1, feedback: 1 }, 'what it was built from');
  eq(full.revision, rows.find((r) => r.id === client.id).revision, 'the revision it was built on');

  // 2. What comes back: a valid brief, ids added, nothing invented kept.
  const b = full.brief;
  eq([b.version, b.identity.colors, b.identity.typography], [1, [{ name: 'Bleu', value: '#1E3A8A' }], ''], 'a colour only as #RRGGBB');
  eq(b.goals.map((g) => g.title), ['Faire connaître les ateliers de robotique'], 'empty goals dropped');
  eq(b.requirements.map((r) => [r.text, r.priority]), [['Deux reels par semaine', 'must'], ['Sous-titres en français', 'must']], 'priorities are must or prefer');
  eq(b.references.map((r) => r.url), ['https://alkhaouarizmi.ma'], 'only links found in the client’s material');
  ok([...b.goals, ...b.requirements, ...b.references].every((x) => typeof x.id === 'string' && x.id.length > 10), 'each entry gets its id');
}

// 3. Applying: replace all, or fill only the empty sections; colours and links kept when the AI has none.
{
  const current = { version: 1, overview: 'Notre histoire, écrite à la main.', audience: '', voice: '', identity: { colors: [{ name: 'Or', value: '#E5B95C' }], typography: 'Poppins', direction: '', dos: '', donts: '' }, goals: [], requirements: [], references: [] };
  const merged = lib.fillEmptySections(current, lib.toBrief(proposal, current, ['https://alkhaouarizmi.ma']));
  eq([merged.overview, merged.identity.colors, merged.identity.typography], ['Notre histoire, écrite à la main.', [{ name: 'Or', value: '#E5B95C' }], 'Poppins'], 'written sections stay as they are');
  eq([merged.audience, merged.goals.length], [proposal.audience, 1], 'empty ones take the proposal');
  const noColours = lib.toBrief({ ...proposal, identity: { ...proposal.identity, colors: [], typography: '' }, references: [] }, current, []);
  eq([noColours.identity.colors, noColours.identity.typography], [[{ name: 'Or', value: '#E5B95C' }], 'Poppins'], 'the brand’s colours and fonts are kept when the AI can’t see them');
  eq(lib.toBrief({}, undefined, []), null, 'an empty answer is no brief');
  const saved = await post(records, { action: 'update', kind: 'client', id: client.id, revision: (await records.GET(new Request(`${B}/api/records`, { headers: { 'X-Workspace-Id': WS } })).then((r) => r.json())).records.find((r) => r.id === client.id).revision, data: { name: 'Centre Alkhaouarizmi', brief: merged } });
  ok(saved.records.find((r) => r.id === client.id).brief.goals.length === 1, 'and it saves like any brief');
}

// 4. Who may ask, and when it fails.
{
  for (const role of ['creative', 'social', 'viewer']) {
    as(await people(role, role));
    const d = await post(ai, { action: 'brief', clientId: client.id }, 403);
    ok(/propriétaire et les administrateurs|réservée à l’équipe/.test(d.error), `${role}: refused`);
  }
  as(await people('admin', 'admin'));
  const before = sent.length;
  await post(ai, { action: 'brief', clientId: 'nope' }, 404);
  eq(sent.length, before, 'an unknown client never reaches the AI');
  groqStatus = 503;
  ok(/ne répond pas/.test((await post(ai, { action: 'brief', clientId: client.id }, 502)).error), 'the AI down: said so');
  groqStatus = 200;
  answer = () => ({ content: 'not json' });
  await post(ai, { action: 'brief', clientId: client.id }, 502);
  answer = () => ({ content: JSON.stringify({ overview: '' }) });
  ok(/exploitable/.test((await post(ai, { action: 'brief', clientId: client.id }, 502)).error), 'an empty proposal is refused');
  answer = () => ({ content: JSON.stringify(proposal) });
  ok((await post(ai, { action: 'brief', clientId: client.id })).brief.overview.startsWith('Centre de formation'), 'an administrator may ask');
}

// 5. A client with nothing yet: the brief rests on its file alone.
{
  as(owner);
  const fresh = await post(records, { action: 'create', kind: 'client', data: { name: 'Nouveau client' } });
  const d = await post(ai, { action: 'brief', clientId: fresh.id });
  eq(d.basis, { months: 0, ideas: 0, tasks: 0, posts: 0, requests: 0, feedback: 0 }, 'nothing to read but the file');
}

console.log(`${checks} brand-brief AI checks passed: the client's own material only, no prices or contracts, a valid brief without invented colours or links, replace or fill, roles and failures.`);
