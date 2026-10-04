// Meetings (lib/meetings.ts, /api/records meeting-save / meeting-cancel, /api/meetings/join, lib/daily.ts):
// who plans, who is told, who sees what, when a call opens, and what Daily is asked. Daily is stubbed.
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
const records = await bundle('app/api/records/route.ts', 'meetings-records.mjs');
const joinRoute = await bundle('app/api/meetings/join/route.ts', 'meetings-join.mjs');
const rules = await bundle('lib/meetings.ts', 'meetings-rules.mjs');

// ---- Daily, stubbed: rooms are remembered, every call recorded.
const daily = [];
const rooms = new Set();
let dailyFailure = '';
let dailyFailureStatus = 503;
let transientDeletes = 0;
let malformedDelete = false;
let lostDeleteResponse = false;
const providerLogs = [];
const realError = console.error;
console.error = (...args) => providerLogs.push(args);
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.startsWith('https://api.daily.co/')) return realFetch(url, init);
  const body = init.body ? JSON.parse(init.body) : undefined;
  daily.push({ url: u, method: init.method || 'GET', body, key: new Headers(init.headers).get('authorization') });
  const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  if (dailyFailure && u.includes(dailyFailure)) return reply({ error: 'provider-failure', info: 'debug daily-test-key' }, dailyFailureStatus);
  const room = u.match(/\/rooms\/([^/?]+)$/)?.[1];
  if (room && init.method === 'DELETE') {
    if (transientDeletes > 0) { transientDeletes--; return reply({ error: 'rate-limit-error' }, 429); }
    if (malformedDelete) return reply({ error: 'unexpected-response' });
    if (!rooms.has(room)) return reply({ error: 'not-found' }, 404);
    rooms.delete(room);
    if (lostDeleteResponse) { lostDeleteResponse = false; throw new TypeError('Connection lost'); }
    return reply({ deleted: true });
  }
  if (room && (init.method || 'GET') === 'GET') return rooms.has(room) ? reply({ name: room, url: `https://theone.daily.co/${room}` }) : reply({ error: 'not-found' }, 404);
  if (room) return rooms.has(room) ? reply({ name: room, url: `https://theone.daily.co/${room}` }) : reply({ error: 'not-found' }, 404);
  if (u.endsWith('/rooms')) { rooms.add(body.name); return reply({ name: body.name, url: `https://theone.daily.co/${body.name}` }); }
  if (u.endsWith('/meeting-tokens')) return reply({ token: `tok-${body.properties.user_id}` });
  return reply({}, 404);
};

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const WS = 'ws:owner';
const B = 'https://space.test';
const owner = { userId: 'owner', fullName: 'Owner', displayName: 'Owner', email: 'owner@studio.test' };
const as = (user) => { globalThis.testUser = user; };
const post = async (body, status = 200) => {
  const r = await records.POST(new Request(`${B}/api/records`, { method: 'POST', headers: { 'Content-Type': 'application/json', origin: B, 'X-Workspace-Id': WS }, body: JSON.stringify(body) }));
  const d = await r.json(); assert.equal(r.status, status, JSON.stringify(d)); checks++; return d;
};
const get = async () => (await records.GET(new Request(`${B}/api/records`, { headers: { 'X-Workspace-Id': WS } }))).json();
const join = async (meetingId, status = 200, locale = 'fr') => {
  const r = await joinRoute.POST(new Request(`${B}/api/meetings/join`, { method: 'POST', headers: { 'Content-Type': 'application/json', origin: B, 'X-Workspace-Id': WS }, body: JSON.stringify({ meetingId, locale }) }));
  const d = await r.json(); assert.equal(r.status, status, JSON.stringify(d)); checks++; return d;
};
const people = async (id, role, clientId = null) => {
  await pg.query('INSERT INTO users (id, name, email, password_hash) VALUES ($1, $1, $2, $3)', [id, `${id}@studio.test`, 'x']);
  await pg.query('INSERT INTO workspace_members (workspace_id, user_id, role, name, email, client_id) VALUES ($1, $2, $3, $2, $4, $5)', [WS, id, role, `${id}@studio.test`, clientId]);
  return { userId: id, fullName: id, displayName: id, email: `${id}@studio.test` };
};
const casablanca = (offsetMinutes = 0) => {
  const at = new Date(Date.now() + offsetMinutes * 60_000);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Casablanca', hour: '2-digit', minute: '2-digit', hour12: false }).format(at).replace(/^24/, '00');
  return { due: day, time };
};

// 1. The rules: fields, Casablanca time, phases.
{
  eq(rules.meetingFields({ name: '', due: '2026-10-01', time: '10:00', duration: 30 }).error, 'Donnez un titre à la réunion.', 'a title is needed');
  eq(rules.meetingFields({ name: 'x', due: '2026-10-01', time: '25:00', duration: 30 }).error, 'Choisissez l’heure de la réunion.', 'a real time');
  eq(rules.meetingFields({ name: 'x', due: '2026-10-01', time: '10:00', duration: 5 }).error, 'Durée invalide.', 'at least 10 minutes');
  eq(rules.meetingFields({ name: 'x', due: '2026-10-01', time: '10:00', duration: 30, link: 'http://zoom.us/j/1' }).error, 'Le lien de la réunion doit commencer par https://.', 'links are https');
  eq(rules.meetingFields({ name: ' Point ', due: '2026-10-01', time: '10:00', duration: 30, callMode: 'audio', attendees: ['a', 'a', ' '] }).attendees, ['a'], 'attendees are cleaned');
  eq(rules.meetingStart({ due: '2026-10-01', time: '10:00' }).toISOString(), '2026-10-01T09:00:00.000Z', 'Casablanca time (UTC+1)');
  const m = { kind: 'meeting', due: '2026-10-01', time: '10:00', duration: 30 };
  eq(['2026-10-01T08:00:00Z', '2026-10-01T08:45:00Z', '2026-10-01T09:10:00Z', '2026-10-01T10:00:00Z', '2026-10-01T12:00:00Z'].map((t) => rules.meetingPhase(m, new Date(t))),
    ['upcoming', 'open', 'live', 'open', 'over'], 'opens 30 minutes before, live during, joinable 2 hours after');
  eq(rules.meetingPhase({ ...m, cancelledAt: 'x' }, new Date('2026-10-01T09:10:00Z')), 'cancelled', 'a cancelled meeting stays cancelled');
  const finished = { ...m, id: 'finished', endedAt: '2026-10-01T09:05:00Z' };
  eq(rules.meetingPhase(finished, new Date('2026-10-01T09:10:00Z')), 'over', 'ending overrides the planned duration immediately');
  eq(rules.meetingLists([finished], '2026-10-01', new Date('2026-10-01T09:10:00Z')), { coming: [], past: [finished] }, 'a finished call moves into history immediately');
}

// Studio, clients, people.
as(owner);
await records.GET(new Request(`${B}/api/records`));
const kojo = await post({ action: 'create', kind: 'client', data: { name: 'Kojo Bakery' } });
const atlas = await post({ action: 'create', kind: 'client', data: { name: 'Atlas Motors' } });
const crea = await people('crea', 'creative');
const other = await people('other', 'creative');
const smm = await people('smm', 'social');
const contact = await people('boss', 'client', kojo.id);
const atlasContact = await people('atlas', 'client', atlas.id);

// 2. Planning: who may, who is told.
const soon = casablanca(10);
const planned = await post({ action: 'meeting-save', data: { name: 'Point mensuel', clientId: kojo.id, ...soon, duration: 30, callMode: 'video', attendees: ['crea'], description: 'Plan de novembre' } });
const meeting = planned.records.find((r) => r.id === planned.id);
eq([meeting.kind, meeting.name, meeting.clientId, meeting.attendees, meeting.attendeeNames], ['meeting', 'Point mensuel', kojo.id, ['crea'], ['Owner', 'crea']], 'the meeting is saved with its guests');
const told = planned.records.filter((r) => r.kind === 'event' && r.meetingId === meeting.id);
ok(told.some((e) => e.audience === 'studio' && e.recipients?.includes('crea') && !e.recipients.includes('owner')), 'the invited team member is told (not the one who planned it)');
ok(told.some((e) => e.audience === 'client' && e.clientId === kojo.id), 'and the client, in their portal');
await post({ action: 'meeting-save', data: { name: 'x', ...soon, duration: 30, attendees: ['boss'] } }, 400); // a client contact is not a team member
await post({ action: 'meeting-save', data: { name: 'x', clientId: 'nope', ...soon, duration: 30 } }, 404);
as(crea); await post({ action: 'meeting-save', data: { name: 'x', ...soon, duration: 30 } }, 403);
as(contact); await post({ action: 'meeting-save', data: { name: 'x', ...soon, duration: 30 } }, 403);
as(smm);
const internal = await post({ action: 'meeting-save', data: { name: 'Brief équipe', ...casablanca(24 * 60), duration: 15, callMode: 'audio', attendees: ['other'] } });
ok(internal.records.some((r) => r.id === internal.id && !r.clientId), 'a social media manager plans a team-only call');

// 3. Who sees what.
as(crea);
eq((await get()).records.filter((r) => r.kind === 'meeting').map((r) => r.name), ['Point mensuel'], 'a member sees the meetings they are invited to');
as(other);
eq((await get()).records.filter((r) => r.kind === 'meeting').map((r) => r.name), ['Brief équipe'], 'and not the others');
as(contact);
const portal = (await get()).records;
const seen = portal.find((r) => r.kind === 'meeting');
eq([seen?.name, seen?.attendees, seen?.authorId, seen?.attendeeNames], ['Point mensuel', undefined, undefined, ['Owner', 'crea']], 'the client sees their meeting, without internal ids');
ok(portal.some((r) => r.kind === 'event' && r.meetingId === meeting.id), 'and the notice about it');
as(atlasContact);
eq((await get()).records.filter((r) => r.kind === 'meeting').length, 0, 'another client sees nothing');

// 4. Joining.
env.DAILY_API_KEY = 'daily-test-key';
as(contact);
const link = await join(meeting.id, 200, 'fr');
eq(link.provider, 'daily', 'the call is on Daily');
eq(link.canEnd, false, 'client contacts leave calls but cannot end them for everyone');
ok(link.url.startsWith(`https://theone.daily.co/the-one-${meeting.id}?t=`), 'a personal link into the meeting’s own room');
const created = daily.find((c) => c.url.endsWith('/rooms') && c.method === 'POST');
eq([created.body.privacy, created.key], ['private', 'Bearer daily-test-key'], 'the room is private, created with the studio’s key');
const clientToken = daily.filter((c) => c.url.endsWith('/meeting-tokens')).at(-1).body.properties;
eq([clientToken.user_name, clientToken.is_owner, clientToken.start_video_off, clientToken.lang], ['boss', false, false, 'fr'], 'the client joins under their name, as a guest, camera on');
as(owner);
eq((await join(meeting.id)).canEnd, true, 'the host gets the End meeting control');
eq(daily.filter((c) => c.url.endsWith('/rooms') && c.method === 'POST').length, 1, 'the room is reused, not created again');
eq(daily.filter((c) => c.url.endsWith('/meeting-tokens')).at(-1).body.properties.is_owner, true, 'the studio joins as the room’s host');
as(crea); await join(meeting.id);
as(other); eq((await join(meeting.id, 404)).error, 'Réunion introuvable.', 'someone not invited can’t join (nor learn it exists)');
as(atlasContact); await join(meeting.id, 404);
as(other);
eq((await join(internal.id, 409)).error, 'La réunion ouvre 30 minutes avant l’heure prévue.', 'a guest waits for the meeting to open');
as(smm);
await join(internal.id);
eq(daily.filter((c) => c.url.endsWith('/meeting-tokens')).at(-1).body.properties.start_video_off, true, 'an audio call starts with cameras off; its planner may open it early');
// A link the studio pasted wins over Daily.
as(owner);
const meet = await post({ action: 'meeting-save', data: { name: 'Via Meet', clientId: kojo.id, ...soon, duration: 30, link: 'https://meet.google.com/abc-defg-hij' } });
const before = daily.length;
eq(await join(meet.id), { provider: 'link', url: 'https://meet.google.com/abc-defg-hij' }, 'a Google Meet link opens as is');
eq(daily.length, before, 'without asking Daily');
delete env.DAILY_API_KEY;
eq((await join(meeting.id, 503)).error, 'Les appels ne sont pas encore activés (DAILY_API_KEY). Ajoutez un lien de réunion ou activez Daily.', 'without a key, it says what is missing');
env.DAILY_API_KEY = 'daily-test-key';

// 5. Moving and cancelling.
const current = (await get()).records.find((r) => r.id === meeting.id);
const later = casablanca(3 * 24 * 60);
const moved = await post({ action: 'meeting-save', id: meeting.id, revision: current.revision, data: { name: 'Point mensuel', clientId: kojo.id, ...later, duration: 45, attendees: ['crea', 'other'] } });
ok(moved.records.some((r) => r.kind === 'event' && r.meetingId === meeting.id && r.name.startsWith('Owner a déplacé') && r.recipients?.includes('other')), 'moving it tells everyone invited');
await post({ action: 'meeting-save', id: meeting.id, revision: current.revision, data: { name: 'Point mensuel', ...later, duration: 45 } }, 409);
await post({ action: 'meeting-cancel', id: meeting.id });
as(crea); eq((await join(meeting.id, 409)).error, 'Cette réunion a été annulée.', 'a cancelled meeting can’t be joined');
as(contact);
ok((await get()).records.some((r) => r.kind === 'event' && r.id === `evt:${meeting.id}:cancel-client`), 'the client hears it was cancelled');
as(crea); await post({ action: 'meeting-cancel', id: meet.id }, 403);

// 6. Explicit completion: permissions, provider termination, history, idempotence and failure/retry.
as(owner);
const active = await post({ action: 'meeting-save', data: { name: 'Finished check-in', clientId: kojo.id, ...casablanca(-5), duration: 60, attendees: ['crea'], callMode: 'video' } });
await join(active.id);
const providerBefore = daily.length;
as(crea); await post({ action: 'meeting-end', id: active.id }, 403);
as(contact); await post({ action: 'meeting-end', id: active.id }, 403);
eq(daily.length, providerBefore, 'unauthorized completion never contacts the call provider');
as(owner); await post({ action: 'meeting-end', id: 'nonexistent' }, 404);
await post({ action: 'meeting-end', id: kojo.id }, 404);
await post({ action: 'meeting-end', id: meeting.id }, 409);
dailyFailure = `/rooms/the-one-${active.id}`;
const failedBefore = daily.length;
await post({ action: 'meeting-end', id: active.id }, 502);
eq(daily.length - failedBefore, 3, 'transient server failures receive bounded retries');
ok(rooms.has(`the-one-${active.id}`), 'a failed shutdown preserves the provider room');
ok(providerLogs.length > 0 && !JSON.stringify(providerLogs).includes('daily-test-key'), 'completion failures are logged without exposing the API key');
let activeRecord = (await get()).records.find((r) => r.id === active.id);
eq([activeRecord.endedAt, activeRecord.cancelledAt], [undefined, undefined], 'a provider failure never falsely marks the meeting completed or cancelled');
dailyFailure = '';
const finished = await post({ action: 'meeting-end', id: active.id });
const done = finished.records.find((r) => r.id === active.id);
ok(!!done.endedAt && done.endedBy === 'Owner' && !done.cancelledAt, 'the host can retry: finished timestamp and actor, without cancellation');
eq(rules.meetingPhase(done), 'over', 'completion is reflected before the scheduled hour ends');
const closing = daily.filter((r) => r.url.endsWith(`the-one-${active.id}`)).at(-1);
eq([closing.method, closing.body], ['DELETE', undefined], 'the documented end-for-everyone request removes the temporary room in one step');
ok(!rooms.has(`the-one-${active.id}`), 'old join links cannot reopen the completed room');
ok(!daily.some((r) => r.url.includes('/presence') || r.url.endsWith('/eject')), 'completion does not rely on presence permissions, participant limits or expired-room ejection races');
const endedEvents = finished.records.filter((r) => r.meetingId === active.id && r.id.includes(':end'));
eq(endedEvents.length, 2, 'the team and client receive completion notices');
ok(endedEvents.every((e) => !e.name.includes('annul')), 'completion notices never call the meeting cancelled');
const closedRequests = daily.length;
await post({ action: 'meeting-end', id: active.id });
eq(daily.length, closedRequests, 'repeating completion does not contact Daily again');
eq((await get()).records.filter((r) => r.meetingId === active.id && r.id.includes(':end')).length, 2, 'repeating completion does not duplicate notifications');
await post({ action: 'meeting-cancel', id: active.id }, 409);
await post({ action: 'meeting-save', id: done.id, revision: done.revision, data: { name: done.name, ...casablanca(), duration: 60 } }, 400);
as(contact);
eq((await join(active.id, 409)).error, 'Cette réunion est terminée.', 'a completed meeting cannot be rejoined');
const clientDone = (await get()).records.find((r) => r.id === active.id);
ok(!!clientDone.endedAt && !clientDone.cancelledAt, 'the client portal sees completion, not cancellation');
eq(daily.length, closedRequests, 'a blocked rejoin never reopens the room');

// External calls and meetings with no integrated room can still be marked finished.
as(owner);
const externalBefore = daily.length;
await post({ action: 'meeting-end', id: meet.id });
eq(daily.length, externalBefore, 'finishing an external meeting does not try to control Google Meet');
await join(meet.id, 409);
const unopened = await post({ action: 'meeting-save', data: { name: 'Not opened', clientId: kojo.id, ...casablanca(), duration: 30 } });
await post({ action: 'meeting-end', id: unopened.id });
ok((await get()).records.find((r) => r.id === unopened.id).endedAt, 'a missing Daily room is already closed and can be completed');

// A temporary provider refusal is retried; invalid credentials and ambiguous responses stay unfinished.
const retry = await post({ action: 'meeting-save', data: { name: 'Retry check', clientId: kojo.id, ...casablanca(), duration: 30 } });
await join(retry.id);
dailyFailure = `/rooms/the-one-${retry.id}`;
dailyFailureStatus = 401;
const authBefore = daily.length;
eq((await post({ action: 'meeting-end', id: retry.id }, 502)).error, 'Clé Daily refusée (DAILY_API_KEY).', 'invalid credentials report the configuration problem');
eq(daily.length - authBefore, 1, 'invalid credentials are not pointlessly retried');
dailyFailure = '';
malformedDelete = true;
await post({ action: 'meeting-end', id: retry.id }, 502);
ok(!(await get()).records.find((r) => r.id === retry.id).endedAt, 'an unexpected success body does not falsely mark the meeting completed');
malformedDelete = false;
delete env.DAILY_API_KEY;
const missingKeyBefore = daily.length;
await post({ action: 'meeting-end', id: retry.id }, 502);
eq(daily.length, missingKeyBefore, 'a missing key never attempts unauthenticated shutdown');
ok(!(await get()).records.find((r) => r.id === retry.id).endedAt, 'a missing key cannot falsely complete an active call');
env.DAILY_API_KEY = 'daily-test-key';
transientDeletes = 1;
const retryBefore = daily.length;
await post({ action: 'meeting-end', id: retry.id });
eq(daily.length - retryBefore, 2, 'a temporary rate limit is retried successfully');
ok((await get()).records.find((r) => r.id === retry.id).endedAt, 'successful shutdown after backoff completes the meeting');

// Provider shutdown can succeed while its response is lost: the same end action recovers on 404.
const lost = await post({ action: 'meeting-save', data: { name: 'Lost response check', clientId: kojo.id, ...casablanca(), duration: 30 } });
await join(lost.id);
lostDeleteResponse = true;
await post({ action: 'meeting-end', id: lost.id }, 502);
ok(!(await get()).records.find((r) => r.id === lost.id).endedAt && !rooms.has(`the-one-${lost.id}`), 'an unacknowledged shutdown keeps completion retryable');
await post({ action: 'meeting-end', id: lost.id });
ok((await get()).records.find((r) => r.id === lost.id).endedAt, 'retry after a lost response records completion without reopening the call');

// 7. Deleting a client takes its meetings with it.
as(owner);
const kojoNow = (await get()).records.find((r) => r.id === kojo.id);
await post({ action: 'delete', kind: 'client', id: kojo.id, revision: kojoNow.revision });
const left = (await get()).records;
eq(left.filter((r) => r.kind === 'meeting').map((r) => r.name), ['Brief équipe'], 'the client’s meetings are gone');
eq(left.filter((r) => r.kind === 'event' && r.meetingId === meeting.id).length, 0, 'and their notices');

globalThis.fetch = realFetch;
console.error = realError;
await pg.close();
console.log(`${checks} meeting checks passed: planning, visibility, joining, completion vs cancellation, host permissions, Daily room shutdown, provider failures, backoff, missing credentials, lost responses, idempotence, portal history, blocked rejoins, external links, client deletion.`);
