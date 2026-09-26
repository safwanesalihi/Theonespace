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
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.startsWith('https://api.daily.co/')) return realFetch(url, init);
  const body = init.body ? JSON.parse(init.body) : undefined;
  daily.push({ url: u, method: init.method || 'GET', body, key: new Headers(init.headers).get('authorization') });
  const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  const room = u.match(/\/rooms\/([^/?]+)$/)?.[1];
  if (room && (init.method || 'GET') === 'GET') return rooms.has(room) ? reply({ name: room, url: `https://theone.daily.co/${room}` }) : reply({ error: 'not-found' }, 404);
  if (room) return reply({ name: room, url: `https://theone.daily.co/${room}` });
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
ok(link.url.startsWith(`https://theone.daily.co/the-one-${meeting.id}?t=`), 'a personal link into the meeting’s own room');
const created = daily.find((c) => c.url.endsWith('/rooms') && c.method === 'POST');
eq([created.body.privacy, created.key], ['private', 'Bearer daily-test-key'], 'the room is private, created with the studio’s key');
const clientToken = daily.filter((c) => c.url.endsWith('/meeting-tokens')).at(-1).body.properties;
eq([clientToken.user_name, clientToken.is_owner, clientToken.start_video_off, clientToken.lang], ['boss', false, false, 'fr'], 'the client joins under their name, as a guest, camera on');
as(owner);
await join(meeting.id);
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

// 6. Deleting a client takes its meetings with it.
as(owner);
const kojoNow = (await get()).records.find((r) => r.id === kojo.id);
await post({ action: 'delete', kind: 'client', id: kojo.id, revision: kojoNow.revision });
const left = (await get()).records;
eq(left.filter((r) => r.kind === 'meeting').map((r) => r.name), ['Brief équipe'], 'the client’s meetings are gone');
eq(left.filter((r) => r.kind === 'event' && r.meetingId === meeting.id).length, 0, 'and their notices');

globalThis.fetch = realFetch;
await pg.close();
console.log(`${checks} meeting checks passed: fields, Casablanca time, phases, who plans, who is told, who sees, joining on Daily (private room, personal links, audio mode, host), pasted links, not configured, moving, cancelling, client deletion.`);
