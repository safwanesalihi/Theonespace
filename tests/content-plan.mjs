// Plan Éditorial (lib/content-plan*.ts, /api/content-plan): the month skeleton (exact quotas, series on
// their weekday, shoot days), the AI draft checked and retried once, items saved as real tasks, locks,
// regeneration, editing, sharing with the client (hidden from the portal until then, comments through
// the task thread), duplication, archiving (never deleting), and who may do what. Gemini is stubbed:
// it answers from the responseSchema the app sends, so the constraints travel with the request.
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
globalThis.testEnv = { AUTH_URL: origin, OWNER_EMAIL: 'contact@the1core.com', OWNER_PASSWORD: 'TOC-owner-test-password', GEMINI_API_KEY: 'test-gemini-key' };
const load = (n) => import(pathToFileURL(`${process.cwd()}/.sites-runtime/content-plan-tests/${n}.mjs`));
const [password, records, planRoute, core] = await Promise.all(['password', 'records', 'plan', 'core'].map(load));

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

// ---------------------------------------------------------------- 1. the skeleton, pure
{
  const s = core.buildSkeleton(core.alkhaouarizmiProfile, '2026-10');
  const reels = s.slots.filter((x) => x.type === 'reel'), posts = s.slots.filter((x) => x.type === 'post');
  eq([reels.length, posts.length], [12, 12], 'October: exactly 12 reels and 12 posts');
  eq(reels.filter((x) => x.serie === 'الخوارزمي يوجه').map((x) => x.date), ['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22', '2026-10-29'], 'orientation reel every Thursday');
  eq(reels.filter((x) => x.serie === 'دقيقة مع أستاذ').map((x) => x.date), ['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27'], 'teacher tip every Tuesday');
  eq(posts.filter((x) => x.serie === 'Élève du mois').map((x) => x.date), ['2026-10-30'], 'student of the month on the last Friday');
  ok(s.slots.every((x) => x.date.startsWith('2026-10-')), 'every slot inside the month');
  eq([s.slots[0].code, reels.at(-1).code, posts.at(-1).code], ['R1', 'R12', 'P12'], 'codes in date order');
  eq(s.shootDays, [{ label: 'J1', date: '2026-09-29' }, { label: 'J2', date: '2026-10-15' }], 'J1 before the first publication, J2 mid-month');
  eq(s.stories.map((x) => x.name), ['حكمة اليوم', 'هل تعلم', 'Best of the day (vidéo)', 'تذكير بحصص الغد', 'Élève de la semaine'], 'recurring stories, the weekly story series included');
  for (const month of ['2026-02', '2026-11', '2027-01', '2027-06']) {
    const k = core.buildSkeleton(core.alkhaouarizmiProfile, month);
    eq([k.slots.filter((x) => x.type === 'reel').length, k.slots.filter((x) => x.type === 'post').length], [12, 12], `${month}: 12 + 12`);
  }
  const few = core.normalizeProfile({ ...core.alkhaouarizmiProfile, quotas: { reels: 3, posts: 20, storiesPerDay: 2 } });
  const f = core.buildSkeleton(few, '2026-10');
  eq([f.slots.filter((x) => x.type === 'reel').length, f.slots.filter((x) => x.type === 'post').length], [3, 20], 'series cut to a small quota, missing post days added');
  ok(f.slots.filter((x) => x.type === 'reel').every((x) => x.serie === 'الخوارزمي يوجه'), 'the first series keeps its place when the quota is short');
}

// ---------------------------------------------------------------- stubbed Gemini
const calls = [];
let mode = 'good';
let round = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const gemini = u.startsWith('https://generativelanguage.googleapis.com/'), groq = u.startsWith('https://api.groq.com/');
  if (!gemini && !groq) return realFetch(url, init);
  const body = JSON.parse(init.body);
  const schema = gemini ? body.generationConfig.responseSchema : body.response_format.json_schema.schema;
  calls.push({ url: u, key: gemini ? new Headers(init.headers).get('x-goog-api-key') : new Headers(init.headers).get('authorization'), schema, body, prompt: gemini ? body.contents[0].parts[0].text : body.messages[1].content });
  round++;
  const item = schema.properties.items.items.properties;
  const codes = item.code.enum, cta = item.cta.enum ?? ['x'], people = item.personnes.items.enum ?? [], shoots = item.jour_tournage.enum;
  let items = codes.map((code, i) => ({
    code, titre: `Sujet ${code} (${round})`, format: code.startsWith('R') ? 'reel 30–60 s' : 'carrousel 6 slides',
    hook: `واش عرفتي ${code}؟ (${round})`, contenu: `Le contenu ${code}, version ${round}.`, cta: cta[i % cta.length], personnes: people.slice(0, 1), jour_tournage: shoots[i % 2],
  }));
  if (mode === 'bad-first' && calls.length === 1) {
    items = items.slice(1);
    items[0] = { ...items[0], cta: 'Inscrivez-vous maintenant' };
  }
  const answer = { items };
  if (schema.properties.overview) {
    const month = /Mois : (\S+) (\d{4})/.exec(calls.at(-1).prompt);
    const monthIndex = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'].indexOf(month[1]) + 1;
    const d = (day) => `${month[2]}-${String(monthIndex).padStart(2, '0')}-${day}`;
    Object.assign(answer, {
      overview: `Mois centré sur l’orientation (${round}).`,
      stories: { notes: [{ name: 'حكمة اليوم', note: 'Citations sur la persévérance.' }], special: [{ date: d('10'), name: 'Quiz orientation', type: 'quiz', note: '' }, { date: d('24'), name: 'Boîte à questions parents', type: 'boîte à questions', note: '' }] },
      production: { jours: schema.properties.production.properties.jours.items.properties.jour.enum.map((jour) => ({ jour, elements: [{ contenu: `Reels du ${jour}`, duree: '2 h' }] })), reserve: ['2 reels de réserve pour le mois suivant'] },
      questions_client: ['Valider les élèves qui acceptent d’apparaître', 'Confirmer les dates de tournage'],
    });
  }
  if (groq) return new Response(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(answer) }, finish_reason: 'stop' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] }, finishReason: 'STOP' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

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
const client = await postRecords(owner, WS, { action: 'create', kind: 'client', data: { name: 'Centre Alkhaouarizmi', city: 'Tanger', sector: 'Soutien scolaire' } });
const CID = client.id;

// ---------------------------------------------------------------- 2. profile
let list = await read(owner, WS, { clientId: CID });
eq([list.profile, list.plans, list.canEdit, list.aiConfigured], [null, [], true, true], 'no profile yet');
await api(owner, WS, { action: 'generate', clientId: CID, month: '2026-10' }, 400);
const saved = await api(owner, WS, { action: 'save-profile', clientId: CID, profile: { ...core.alkhaouarizmiProfile, quotas: { reels: '12', posts: 12, storiesPerDay: 4 }, sneaky: 'x' } });
eq([saved.gaps, saved.profile.quotas.reels, saved.profile.series.length, saved.profile.sneaky], [[], 12, 4, undefined], 'profile saved, cleaned');
await api(owner, WS, { action: 'save-profile', clientId: 'nope', profile: {} }, 404);

// ---------------------------------------------------------------- 3. generate October 2026 (first answer wrong, retried)
mode = 'bad-first';
const gen = await api(owner, WS, { action: 'generate', clientId: CID, month: '2026-10', focus: 'Rentrée et choix d’orientation' });
eq(calls.length, 2, 'the first answer failed the checks, one retry');
ok(calls.every((c) => c.key === 'test-gemini-key'), 'Gemini called with its key in the header');
ok(calls[1].prompt.includes('Ta réponse précédente avait ces problèmes') && calls[1].prompt.includes('R1'), 'the retry lists what was wrong');
const sch = calls[0].schema.properties.items.items.properties;
eq(sch.cta.enum, core.alkhaouarizmiProfile.ctaAllowed, 'CTAs constrained to the allowed list in the responseSchema');
eq(calls[0].schema.type, 'OBJECT', 'Gemini schema types in upper case');
const plan = gen.plan;
eq([plan.month, plan.counts, plan.quotas, plan.warnings, plan.shared, plan.archived], ['2026-10', { reels: 12, posts: 12 }, { reels: 12, posts: 12 }, [], false, false], 'October plan: 12/12, no warnings');
ok(plan.generatedWith.startsWith('Gemini'), 'made with Gemini');
let detail = await read(owner, WS, { planId: plan.id });
const items = detail.items;
eq(items.length, 24, '24 items');
ok(items.every((i) => i.kind === 'task' && i.status === 'À faire' && i.clientId === CID && i.due.startsWith('2026-10-')), 'every item is a real task in October');
ok(items.every((i) => i.planHook && i.planContent && i.planCta && !/maintenant/.test(i.planCta)), 'hook, content and an allowed CTA everywhere');
eq(items.find((i) => i.planCode === 'P12').planSerie, 'Élève du mois', 'series kept on the item');
ok(items.every((i) => i.description.includes('Hook :')), 'readable task description');
eq([detail.plan.stories.length, detail.plan.specialStories.length, detail.plan.production.map((p) => p.step), detail.plan.questions.length], [5, 2, ['Tournage J1', 'Tournage J2'], 2], 'stories, production and checklist filled');
const tasks = (await getRecords(owner, WS)).records.filter((r) => r.kind === 'task' && r.planId === plan.id);
eq(tasks.length, 24, 'the items show in the studio’s tasks');
await api(owner, WS, { action: 'generate', clientId: CID, month: '2026-10' }, 409);
await api(owner, WS, { action: 'generate', clientId: CID, month: '2026-13' }, 400);

// ---------------------------------------------------------------- 4. editing, locking, regenerating
const r3 = items.find((i) => i.planCode === 'R3');
const edited = await api(owner, WS, { action: 'update-item', itemId: r3.id, revision: r3.revision, patch: { planHook: 'هاد الهوك كتبناه حنا', planLocked: true, deliverable: 'https://drive.google.com/file/d/abc/view', status: 'En cours', assigneeId: studio.user.id } });
eq([edited.item.planHook, edited.item.planLocked, edited.item.status, edited.item.assigneeId], ['هاد الهوك كتبناه حنا', true, 'En cours', studio.user.id], 'inline edits saved');
await api(owner, WS, { action: 'update-item', itemId: r3.id, revision: r3.revision, patch: { planHook: 'x' } }, 409);
await api(owner, WS, { action: 'update-item', itemId: r3.id, revision: edited.item.revision, patch: { deliverable: 'javascript:alert(1)' } }, 400);
await api(owner, WS, { action: 'update-item', itemId: r3.id, revision: edited.item.revision, patch: { status: 'Perdu' } }, 400);
mode = 'good';
const before = calls.length;
const regen = await api(owner, WS, { action: 'regenerate', planId: plan.id });
eq(regen.changed, 23, 'the 23 unlocked items rewritten');
ok(!calls.at(-1).schema.properties.items.items.properties.code.enum.includes('R3'), 'the locked item is not even asked for');
detail = await read(owner, WS, { planId: plan.id });
eq(detail.items.find((i) => i.planCode === 'R3').planHook, 'هاد الهوك كتبناه حنا', 'the locked item is untouched');
ok(detail.items.find((i) => i.planCode === 'R4').planHook.includes(`(${round})`), 'the others come from the new answer');
await api(owner, WS, { action: 'regenerate-item', planId: plan.id, itemId: r3.id }, 409);
const r4 = detail.items.find((i) => i.planCode === 'R4');
const p5before = detail.items.find((i) => i.planCode === 'P5').planHook;
await api(owner, WS, { action: 'regenerate-item', planId: plan.id, itemId: r4.id });
eq(calls.at(-1).schema.properties.items.items.properties.code.enum, ['R4'], 'one item asked for');
ok(!calls.at(-1).schema.properties.overview, 'without the month’s sections');
detail = await read(owner, WS, { planId: plan.id });
ok(detail.items.find((i) => i.planCode === 'R4').planHook !== r4.planHook && detail.items.find((i) => i.planCode === 'P5').planHook === p5before, 'only that item changed');
eq(calls.length - before, 2, 'two AI calls');
const q = await api(owner, WS, { action: 'update-plan', planId: plan.id, revision: detail.plan.revision, patch: { questions: [{ text: 'Valider les élèves', done: true }, { text: 'Dates de tournage', done: false }] } });
eq(q.plan.questions[0].done, true, 'checklist ticked');

// ---------------------------------------------------------------- 5. the client: hidden until shared, then read-only with comments
const invite = await postRecords(owner, WS, { action: 'invite-member', email: 'parent@alkhaouarizmi.test', name: 'Direction du centre', role: 'client', clientId: CID });
const contact = await passwordChange('parent@alkhaouarizmi.test', invite.invitation.temporaryPassword);
let portal = await getRecords(contact);
eq(portal.records.filter((r) => r.planId).length, 0, 'plan items hidden from the portal before sharing');
eq((await read(contact, WS, {})).plans, [], 'no shared plan yet');
await read(contact, WS, { planId: plan.id }, 404);
await api(contact, WS, { action: 'share', planId: plan.id }, 403);
await api(owner, WS, { action: 'share', planId: plan.id });
portal = await getRecords(contact);
eq(portal.records.filter((r) => r.planId === plan.id).length, 24, 'shared: the client sees the items');
const seen = await read(contact, WS, { planId: plan.id });
eq(seen.items.length, 24, 'the client reads the plan');
ok(seen.items.every((i) => i.planLocked === undefined && i.assignee === undefined) && seen.plan.warnings === undefined, 'without internal fields');
const target = seen.items.find((i) => i.planCode === 'R1');
await postRecords(contact, WS, { action: 'comment', taskId: target.id, text: 'Peut-on montrer la salle d’orientation ?' });
detail = await read(owner, WS, { planId: plan.id });
eq(detail.comments.filter((c) => c.taskId === target.id).map((c) => c.text), ['Peut-on montrer la salle d’orientation ?'], 'the client’s comment shows on the item');
await api(owner, WS, { action: 'unshare', planId: plan.id });
eq((await getRecords(contact)).records.filter((r) => r.planId).length, 0, 'hidden again once unshared');

// ---------------------------------------------------------------- 6. duplicate, archive (never delete)
const dup = await api(owner, WS, { action: 'duplicate', planId: plan.id });
eq([dup.plan.month, dup.plan.counts, dup.plan.shared], ['2026-11', { reels: 12, posts: 12 }, false], 'copied to November');
const nov = await read(owner, WS, { planId: dup.plan.id });
ok(nov.items.every((i) => i.due.startsWith('2026-11-') && i.status === 'À faire' && !i.planLocked), 'November items dated in November, open, unlocked');
eq(nov.items.find((i) => i.planCode === 'R3').planHook, 'هاد الهوك كتبناه حنا', 'content carried over slot by slot');
await api(owner, WS, { action: 'duplicate', planId: plan.id }, 409);
await api(owner, WS, { action: 'archive', planId: plan.id });
const countRows = async () => Number((await db.query("SELECT count(*) AS n FROM records WHERE kind = 'task' AND data->>'planId' = $1", [plan.id]))[0].n);
eq(await countRows(), 24, 'archived, nothing deleted');
ok((await getRecords(owner, WS)).records.filter((r) => r.planId === plan.id).every((r) => r.archived), 'its tasks archived too');
list = await read(owner, WS, { clientId: CID });
eq(list.plans.map((p) => [p.month, p.archived]), [['2026-11', false], ['2026-10', true]], 'plans listed, archive kept');
mode = 'good';
const again = await api(owner, WS, { action: 'generate', clientId: CID, month: '2026-10' });
ok(again.plan.month === '2026-10', 'a new October can be generated after archiving');
await api(owner, WS, { action: 'unarchive', planId: plan.id }, 409);
await api(owner, WS, { action: 'archive', planId: again.plan.id });
await api(owner, WS, { action: 'unarchive', planId: plan.id });
ok((await getRecords(owner, WS)).records.filter((r) => r.planId === plan.id).every((r) => !r.archived), 'unarchived with its tasks');

// ---------------------------------------------------------------- 7. roles and the AI's absence
const creative = await postRecords(owner, WS, { action: 'invite-member', email: 'crea@studio.test', name: 'Yassine', role: 'creative' });
const crea = await passwordChange('crea@studio.test', creative.invitation.temporaryPassword);
ok((await read(crea, WS, { clientId: CID })).canEdit === false, 'a member reads, cannot edit');
await api(crea, WS, { action: 'regenerate', planId: plan.id }, 403);
await api(owner, WS, { action: 'save-profile', clientId: CID, profile: {} }, 200);
eq((await read(owner, WS, { clientId: CID })).gaps.length > 0, true, 'an empty profile lists what is missing');
await api(owner, WS, { action: 'generate', clientId: CID, month: '2027-01' }, 400);
globalThis.testEnv.GEMINI_API_KEY = '';
globalThis.testEnv.GROQ_API_KEY = 'gsk_test';
await api(owner, WS, { action: 'save-profile', clientId: CID, profile: core.alkhaouarizmiProfile });
const viaGroq = await api(owner, WS, { action: 'generate', clientId: CID, month: '2027-02' });
const g = calls.at(-1);
eq([g.url, g.key, g.body.response_format.type, g.body.response_format.json_schema.strict, g.schema.type, g.schema.additionalProperties], ['https://api.groq.com/openai/v1/chat/completions', 'Bearer gsk_test', 'json_schema', true, 'object', false], 'without Gemini: Groq with a strict JSON schema');
eq([viaGroq.plan.counts, viaGroq.plan.warnings], [{ reels: 12, posts: 12 }, []], 'February via Groq: 12/12');
globalThis.testEnv.GROQ_API_KEY = '';
const noAi = await api(owner, WS, { action: 'generate', clientId: CID, month: '2027-01' }, 502);
ok(/pas configurée/.test(noAi.error), 'no AI key: a clear message, nothing created');
eq((await read(owner, WS, { clientId: CID })).plans.some((p) => p.month === '2027-01'), false, 'no half plan');

globalThis.fetch = realFetch;
await pg.close();
console.log(`${checks} Plan Éditorial checks passed: exact quotas and series days, shoot days, stories, Gemini with a responseSchema and one retry, Groq with a strict JSON schema, items as real tasks, inline edits, locks, regeneration of the plan and of one item, the client (hidden until shared, read-only, comments), duplication, archiving without deleting, roles.`);
