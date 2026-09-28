// Repeating social posts (lib/social-repeat.ts, lib/editorial-repeat.ts): the rules (every day, some
// weekdays, every month, an end date), saving a series, and the scheduled run — the day's copy made
// and published once, the series moved on, missed days skipped, the client's approval, the end of a
// series, and a copy that can never delete the series' files. Meta and storage are stubbed.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';

const esbuildPath = globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0] || 'node_modules/esbuild/lib/main.js';
const esbuild = await import(pathToFileURL(esbuildPath));
mkdirSync('.sites-runtime', { recursive: true });
const bundles = { records: 'app/api/records/route.ts', publish: 'app/api/editorial/publish/route.ts', due: 'app/api/editorial/publish-due/route.ts', rules: 'lib/social-repeat.ts' };
for (const [name, entry] of Object.entries(bundles)) {
  await esbuild.build({ entryPoints: [entry], outfile: `.sites-runtime/repeat-${name}.mjs`, bundle: true, platform: 'node', format: 'esm', plugins: [testRuntimePlugin({ auth: false })] });
}
const { db, pg } = await createTestDb();
globalThis.testDb = db;
const CRON = 'c'.repeat(40);
const SUPABASE = 'https://proj.supabase.test';
globalThis.testEnv = {
  OWNER_EMAIL: 'owner@studio.test', AUTH_URL: 'https://space.test', CRON_SECRET: CRON, SUPABASE_URL: SUPABASE, SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  META_PUBLISH_TOKEN: 'system-token', META_STUDIO_FACEBOOK_PAGE_ID: '5555555555',
};
const owner = { userId: 'owner', fullName: 'Owner', displayName: 'Owner', email: 'owner@studio.test' };
globalThis.testUser = owner;
const load = async (name) => import(pathToFileURL(`${process.cwd()}/.sites-runtime/repeat-${name}.mjs`));
const [records, publish, due, rules] = await Promise.all(['records', 'publish', 'due', 'rules'].map(load));

// ---- Meta and storage, stubbed.
const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url), method = init.method || 'GET';
  const body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
  const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.startsWith(SUPABASE)) { calls.push({ service: 'storage', method, url: u, body }); return reply({}); }
  if (!u.startsWith('https://graph.facebook.com/')) return realFetch(url, init);
  const path = u.slice('https://graph.facebook.com/v21.0/'.length);
  calls.push({ service: 'meta', method, path, body });
  if (method === 'GET' && /\?fields=access_token$/.test(path)) return reply({ access_token: 'page-token' });
  if (method === 'POST' && /\/feed$/.test(path)) return reply({ id: `${path.split('/')[0]}_${calls.length}` });
  if (method === 'POST' && /\/photos$/.test(path)) return reply({ id: 'photo1', post_id: `${path.split('/')[0]}_${calls.length}` });
  return reply({});
};

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const WS = 'ws:owner';
const request = (route, body) => route.POST(new Request('https://space.test/api/x', {
  method: 'POST', headers: { 'Content-Type': 'application/json', origin: 'https://space.test', 'X-Workspace-Id': WS }, body: JSON.stringify(body),
}));
async function post(body, status = 200) {
  const r = await request(records, body); const d = await r.json(); assert.equal(r.status, status, JSON.stringify(d)); checks++; return d;
}
const view = async () => (await (await records.GET(new Request('https://space.test/api/records', { headers: { 'X-Workspace-Id': WS } }))).json()).records;
const find = async (id) => (await view()).find((r) => r.id === id);
const run = async () => { const r = await due.GET(new Request('https://space.test/api/editorial/publish-due', { headers: { Authorization: `Bearer ${CRON}` } })); return r.json(); };
const feeds = () => calls.filter((c) => c.service === 'meta' && c.method === 'POST' && /\/(feed|photos)$/.test(c.path));
const casablanca = (offsetDays = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(new Date(Date.now() + offsetDays * 86_400_000));
// A time a minute ago in Casablanca (00:00 just after midnight), so « today » is already due.
const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Casablanca', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(Date.now() - 60_000)).replace(/^24/, '00');
const justNow = casablanca(0) === new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(new Date(Date.now() - 60_000)) ? clock : '00:00';
const weekdayOf = (day) => new Date(`${day}T12:00:00Z`).getUTCDay();

// 1. The rules.
{
  const { normalizeRepeat, nextRepeatDay, repeatsOn, seriesStep, repeatLabel } = rules;
  eq(normalizeRepeat({ every: 'week' }, '2026-09-30'), { every: 'week', days: [3] }, 'weekly defaults to the start date’s weekday');
  eq(normalizeRepeat({ every: 'week', days: [5, 1, 1, 9] }, '2026-09-30'), { every: 'week', days: [1, 5] }, 'weekdays cleaned and sorted');
  eq(normalizeRepeat({ every: 'month' }, '2026-01-31'), { every: 'month', monthDay: 31 }, 'monthly defaults to the start date’s day');
  eq(normalizeRepeat({ every: 'day', until: '2026-01-01' }, '2026-02-01'), { every: 'day' }, 'an end before the start is dropped');
  eq(normalizeRepeat(null, '2026-02-01'), undefined, 'null: no repeat');
  eq(nextRepeatDay({ every: 'week', days: [1, 4] }, '2026-09-29'), '2026-10-01', 'Tuesday → the next Thursday');
  eq(['2026-02-28', '2026-03-31', '2026-04-30'].map((d) => repeatsOn({ every: 'month', monthDay: 31 }, d)), [true, true, true], 'the 31st falls on a shorter month’s last day');
  eq(repeatsOn({ every: 'month', monthDay: 31 }, '2026-04-29'), false, 'and only then');
  eq(nextRepeatDay({ every: 'day', until: '2026-10-02' }, '2026-10-03'), null, 'nothing after the end date');
  // 18:00 in Casablanca (UTC+1) is 17:00 UTC.
  const series = { due: '2026-10-01', time: '18:00', repeat: { every: 'day' } };
  eq(seriesStep(series, new Date('2026-10-01T16:59:00Z')), null, 'nothing before its time');
  eq(seriesStep(series, new Date('2026-10-01T17:05:00Z')), { publish: '2026-10-01', skipped: [], next: '2026-10-02' }, 'on time: that day goes out, the series moves to tomorrow');
  eq(seriesStep(series, new Date('2026-10-03T17:30:00Z')), { publish: '2026-10-03', skipped: ['2026-10-01', '2026-10-02'], next: '2026-10-04' }, 'missed days are skipped, not posted in a burst');
  eq(seriesStep(series, new Date('2026-10-02T09:00:00Z')), { publish: null, skipped: ['2026-10-01'], next: '2026-10-02' }, 'more than 6 hours late: skipped, the series waits for today’s time');
  eq(seriesStep({ ...series, repeat: { every: 'day', until: '2026-10-01' } }, new Date('2026-10-01T17:05:00Z')).next, null, 'the last day: the series ends');
  // One day a week: every Thursday at 18:00 (2026-10-01 is a Thursday).
  const thursdays = { due: '2026-10-01', time: '18:00', repeat: { every: 'week', days: [4] } };
  eq(seriesStep(thursdays, new Date('2026-10-01T17:05:00Z')), { publish: '2026-10-01', skipped: [], next: '2026-10-08' }, 'weekly on one day: published, then next week, same day');
  eq(seriesStep({ ...thursdays, due: '2026-10-08' }, new Date('2026-10-05T17:05:00Z')), null, 'moved to next Thursday: nothing on the days between');
  eq(repeatLabel(thursdays.repeat), ['Chaque {day}', { day: 'jeudi' }], 'label: « Chaque jeudi »');
  eq(repeatLabel({ every: 'week', days: [4, 1] }), ['Chaque {days} et {last}', { days: 'lundi', last: 'jeudi' }], 'label: Monday first');
  eq(repeatLabel({ every: 'week', days: [0, 1, 2, 3, 4, 5, 6] }), ['Tous les jours'], 'seven days is every day');
  eq(repeatLabel({ every: 'month', monthDay: 15 }, (s) => s.toUpperCase()), ['Le {n} de chaque mois', { n: 15 }], 'monthly label');
}

// 2. Saving a series.
await records.GET(new Request('https://space.test/api/records'));
const base = { name: 'Plat du jour', clientId: 'internal', description: 'Le plat du jour est servi 🍲', socialState: 'scheduled', targets: [{ network: 'facebook', format: 'post' }] };
const create = async (data, status = 200) => { const d = await post({ action: 'create', kind: 'editorial_post', data: { ...base, ...data } }, status); return status === 200 ? d.records.find((r) => r.id === d.id) : d; };
{
  const start = casablanca(3);
  const other = [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== weekdayOf(start))[0];
  const weekly = await create({ due: start, time: '10:00', repeat: { every: 'week', days: [other] } });
  eq(weekdayOf(weekly.due), other, 'the date moves to the first chosen weekday');
  ok(weekly.due > start && weekly.due <= casablanca(10), 'within the week');
  eq((await create({ due: start, repeat: { every: 'day', until: casablanca(2) } })).repeat, { every: 'day' }, 'an end before the start is dropped on save');
  const stopped = await post({ action: 'update', kind: 'editorial_post', id: weekly.id, revision: weekly.revision, data: { ...base, due: weekly.due, time: '10:00', repeat: null } });
  eq(stopped.records.find((r) => r.id === weekly.id).repeat, undefined, 'repeat: null stops repeating');
  const kept = stopped.records.find((r) => r.id === weekly.id);
  const again = await post({ action: 'update', kind: 'editorial_post', id: kept.id, revision: kept.revision, data: { ...base, due: kept.due, time: '10:00', repeat: { every: 'month' } } });
  const monthly = again.records.find((r) => r.id === kept.id);
  const moved = await post({ action: 'update', kind: 'editorial_post', id: monthly.id, revision: monthly.revision, data: { ...base, due: monthly.due, time: '11:00' } });
  eq(moved.records.find((r) => r.id === monthly.id).repeat.every, 'month', 'saving without « repeat » keeps it (moving a post in the calendar)');
  const bad = await post({ action: 'create', kind: 'editorial_post', data: { ...base, due: start, repeat: { every: 'year' } } }, 400);
  ok(!!bad.error, 'an unknown rule is refused');
}

// 3. The scheduled run: today's copy, published once; the series moves to tomorrow.
const daily = await create({ due: casablanca(0), time: justNow, repeat: { every: 'day' } });
{
  const r = await publishNow(daily.id, 400);
  ok(/répétée/.test(r.error), '« Publier maintenant » is refused on a series');
  const before = feeds().length;
  await run();
  const copyId = `${daily.id}@${casablanca(0)}`;
  const copy = await find(copyId);
  ok(!!copy, 'the day’s copy is created');
  eq([copy.repeatOf, copy.due, copy.time, copy.description, copy.repeat], [daily.id, casablanca(0), justNow, base.description, undefined], 'a plain post with the series’ content');
  ok(!!copy.publishedAt && copy.publishResults.facebook.ok, 'and it is published in the same run');
  eq(feeds().length, before + 1, 'Facebook got exactly one post');
  const series = await find(daily.id);
  eq([series.due, series.publishedAt, series.socialState], [casablanca(1), undefined, 'scheduled'], 'the series moves to tomorrow');
  ok(series.history.some((h) => h.text === `Publication du ${casablanca(0)} lancée`), 'its history says so');
  await run(); await run();
  eq(feeds().length, before + 1, 'later runs the same day post nothing more');
  eq((await view()).filter((r) => r.repeatOf === daily.id).length, 1, 'one copy per day');
}
async function publishNow(postId, status = 200) {
  const r = await request(publish, { postId }); const d = await r.json(); assert.equal(r.status, status, JSON.stringify(d)); checks++; return d;
}

// 4. Missed days are skipped; an end date ends the series.
{
  const late = await create({ name: 'Rattrapage', due: casablanca(-3), time: justNow, repeat: { every: 'day' } });
  // Saved in the past on purpose: put the series back to three days ago, as if the run had been down.
  await pg.query(`UPDATE records SET data = jsonb_set(data, '{due}', to_jsonb($1::text)) WHERE id = $2`, [casablanca(-3), late.id]);
  const before = feeds().length;
  await run();
  eq((await view()).filter((r) => r.repeatOf === late.id).map((r) => r.due), [casablanca(0)], 'only today goes out');
  eq(feeds().length, before + 1, 'one post, not four');
  const series = await find(late.id);
  eq(series.history.filter((h) => /sautée/.test(h.text)).length, 3, 'the three missed days are noted as skipped');

  const last = await create({ name: 'Dernier jour', due: casablanca(0), time: justNow, repeat: { every: 'day', until: casablanca(0) } });
  await run();
  const ended = await find(last.id);
  ok(!!ended.publishedAt && ended.history.some((h) => h.text === 'Série terminée'), 'after its last day the series ends');
  ok(!!(await find(`${last.id}@${casablanca(0)}`))?.publishedAt, 'its last day was published');
  await run();
  eq((await view()).filter((r) => r.repeatOf === last.id).length, 1, 'and nothing more comes of it');
}

// 5. Drafts wait; the client's approval covers the whole series.
{
  const draft = await create({ name: 'Brouillon', due: casablanca(0), time: justNow, socialState: 'draft', repeat: { every: 'day' } });
  await run();
  eq((await view()).filter((r) => r.repeatOf === draft.id).length, 0, 'a draft series makes no copy');

  const approving = await post({ action: 'create', kind: 'client', data: { name: 'Client qui valide', facebookPageId: '3333333333', postApproval: true } });
  const asked = await create({ name: 'Promo', clientId: approving.id, due: casablanca(0), time: justNow, repeat: { every: 'day' } });
  eq(asked.approval.state, 'pending', 'the client is asked once, for the series');
  await run();
  eq((await view()).filter((r) => r.repeatOf === asked.id).length, 0, 'nothing goes out before the answer');
  await post({ action: 'post-approve', postId: asked.id });
  await run();
  const copy = (await view()).find((r) => r.repeatOf === asked.id);
  ok(copy?.publishedAt && copy.approval.state === 'approved', 'approved: the day’s copy goes out, approved');
  const series = await find(asked.id);
  const edited = await post({ action: 'update', kind: 'editorial_post', id: series.id, revision: series.revision, data: { ...base, clientId: approving.id, due: series.due, time: justNow, repeat: { every: 'week' } } });
  eq(edited.records.find((r) => r.id === asked.id).approval.state, 'pending', 'changing the rule asks the client again');
}

// 6. A copy never owns the series' files: deleting it leaves them in storage.
{
  const file = 'ws_owner/00000077-0000-0000-0000-000000000000.jpg';
  const photo = { url: `${SUPABASE}/storage/v1/object/public/editorial-media/${file}`, type: 'image', path: file };
  const withMedia = await create({ name: 'Photo du jour', due: casablanca(0), time: justNow, media: [photo], repeat: { every: 'day' } });
  await run();
  const copy = (await view()).find((r) => r.repeatOf === withMedia.id);
  eq(copy.media, [{ url: photo.url, type: 'image' }], 'the copy points at the photo without owning it');
  const removals = () => calls.filter((c) => c.service === 'storage' && c.method === 'DELETE').length;
  const before = removals();
  await post({ action: 'delete', kind: 'editorial_post', id: copy.id, revision: copy.revision });
  eq(removals(), before, 'deleting the copy removes no file');
  eq((await find(withMedia.id)).media[0].path, file, 'the series still has its photo');
}

// 7. One date of a series: skipped, or with its own title and text.
{
  const { seriesDay, exceptionsAfter } = rules;
  eq(seriesDay({ name: 'A', description: 'a', repeatExceptions: { '2026-10-02': { skip: true } } }, '2026-10-02'), null, 'pure: a skipped date gives nothing');
  eq(seriesDay({ name: 'A', description: 'a', repeatExceptions: { '2026-10-02': { name: 'B' } } }, '2026-10-02'), { name: 'B', description: 'a', changed: true }, 'pure: its own title, the series’ text');
  eq(seriesDay({ name: 'A', description: 'a' }, '2026-10-03'), { name: 'A', description: 'a', changed: false }, 'pure: other dates are the series');
  eq(exceptionsAfter({ '2026-10-01': { skip: true }, '2026-10-05': { name: 'x' } }, '2026-10-02'), { '2026-10-05': { name: 'x' } }, 'pure: past exceptions dropped');

  // Today: this date only, with its own text.
  const own = await create({ name: 'Menu', due: casablanca(0), time: justNow, repeat: { every: 'day' } });
  const mark = (id, day, exception, status = 200) => find(id).then((s) => post({ action: 'series-date', id, revision: s.revision, day, exception }, status));
  await mark(own.id, casablanca(-1), { skip: true }, 400);
  await mark(own.id, 'demain', { skip: true }, 400);
  await mark(own.id, casablanca(0), { name: '' }, 400);
  await post({ action: 'series-date', id: own.id, revision: 999, day: casablanca(0), exception: { skip: true } }, 409);
  await mark(own.id, casablanca(0), { name: 'Menu spécial', description: 'Aujourd’hui seulement : couscous 🍲' });
  await mark(own.id, casablanca(1), { skip: true });
  await mark(own.id, casablanca(2), { name: 'Menu du vendredi' });
  let series = await find(own.id);
  eq(Object.keys(series.repeatExceptions).sort(), [casablanca(0), casablanca(1), casablanca(2)], 'three dates set apart on the series');
  eq([series.name, series.description], ['Menu', base.description], 'the series itself is unchanged');
  await run();
  const today = await find(`${own.id}@${casablanca(0)}`);
  eq([today.name, today.description, !!today.publishedAt], ['Menu spécial', 'Aujourd’hui seulement : couscous 🍲', true], 'today goes out with its own title and text');
  series = await find(own.id);
  eq(Object.keys(series.repeatExceptions).sort(), [casablanca(1), casablanca(2)], 'today’s exception is dropped once used');
  // Tomorrow is skipped: put the series there as if tomorrow had come.
  await pg.query(`UPDATE records SET data = jsonb_set(data, '{due}', to_jsonb($1::text)) WHERE id = $2`, [casablanca(0), own.id]);
  await pg.query(`UPDATE records SET data = data #- '{repeatExceptions}' || jsonb_build_object('repeatExceptions', jsonb_build_object($1::text, jsonb_build_object('skip', true))) WHERE id = $2`, [casablanca(0), own.id]);
  await pg.query(`DELETE FROM records WHERE id = $1`, [`${own.id}@${casablanca(0)}`]);
  const before = feeds().length;
  await run();
  eq(feeds().length, before, 'a skipped date publishes nothing');
  eq(await find(`${own.id}@${casablanca(0)}`), undefined, 'no copy for it');
  series = await find(own.id);
  ok(series.history.some((h) => /sautée \(à la demande\)/.test(h.text)) && series.due === casablanca(1), 'noted as skipped on request, the series moves on');
  eq(series.repeatExceptions, {}, 'and the exception is gone');

  // Back to the series; a client who approves posts sees a date's new text.
  await mark(own.id, casablanca(3), { skip: true });
  await mark(own.id, casablanca(3), null);
  eq((await find(own.id)).repeatExceptions, undefined, 'a date put back as the series leaves nothing behind');
  const approving = (await view()).find((r) => r.kind === 'client' && r.name === 'Client qui valide');
  const promo = await create({ name: 'Promo 2', clientId: approving.id, due: casablanca(0), time: '23:59', repeat: { every: 'day' } });
  await post({ action: 'post-approve', postId: promo.id });
  await mark(promo.id, casablanca(1), { skip: true });
  eq((await find(promo.id)).approval.state, 'approved', 'skipping a date needs no new approval');
  await mark(promo.id, casablanca(1), { name: 'Promo de demain' });
  eq((await find(promo.id)).approval.state, 'pending', 'a date’s own text is shown to the client first');
}

globalThis.fetch = realFetch;
await pg.close();
console.log(`${checks} repeat checks passed: rules (days, weekdays, months, end date, missed days), saving a series, the day’s copy published once, the series moved on, skipped days, the end of a series, drafts, client approval, files kept, one date skipped or with its own text.`);
