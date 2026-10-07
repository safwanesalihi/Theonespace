import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
const esbuild = await import(pathToFileURL(globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0]));
mkdirSync('.sites-runtime', { recursive: true });
await esbuild.build({ entryPoints: ['lib/time.ts', 'lib/theme.ts', 'lib/task-mentions.ts', 'lib/meetings.ts', 'lib/ig-analyzer/analyze.ts'], outdir: '.sites-runtime/preferences-test', bundle: true, platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' } });
const load = name => import(pathToFileURL(`${process.cwd()}/.sites-runtime/preferences-test/${name}.mjs`));
const time = await load('time'), theme = await load('theme'), mentions = await load('task-mentions'), meetings = await load('meetings');
for (const zone of ['UTC', 'Europe/Paris', 'America/New_York', 'Asia/Tokyo']) {
  process.env.TZ = zone;
  assert.equal(time.formatTimestamp('2026-10-01T10:35:00Z', 'en-GB', { hour: '2-digit', minute: '2-digit' }), '11:35', zone);
  assert.equal(time.formatTimestamp('2026-02-25T10:35:00Z', 'en-GB', { hour: '2-digit', minute: '2-digit' }), '10:35', 'Ramadan follows UTC+0');
  assert.equal(time.appDayKey('2026-10-01T23:30:00Z'), '2026-10-02', 'Casablanca calendar boundary');
  assert.equal(time.formatAppDate('2026-10-01', 'en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }), '2026-10-01');
  assert.equal(new Date(time.periodStart('today', new Date('2026-10-01T23:30:00Z'))).toISOString(), '2026-10-01T23:00:00.000Z');
  assert.equal(new Date(time.periodStart('week', new Date('2026-10-01T23:30:00Z'))).toISOString(), '2026-09-27T23:00:00.000Z');
  assert.equal(new Date(time.periodStart('month', new Date('2026-10-01T23:30:00Z'))).toISOString(), '2026-09-30T23:00:00.000Z');
  assert.equal(meetings.meetingStart({ due: '2026-03-29', time: '02:30' }).toISOString(), '2026-03-29T01:30:00.000Z', 'Europe DST parsing cannot shift Morocco meetings');
  assert.equal(meetings.meetingStart({ due: '2026-02-25', time: '11:30' }).toISOString(), '2026-02-25T11:30:00.000Z');
}
const analyzer = await load('ig-analyzer/analyze');
for (const zone of ['UTC', 'Europe/Paris', 'America/New_York']) {
 process.env.TZ = zone;
 const analyzed = analyzer.analyzeAccount({ profile: { followers_count: 1000 }, posts: [{ id: 'late-post', type: 'IMAGE', timestamp: '2026-10-01T23:30:00Z', caption: '', likes: 10, comments: 2, views: null, duration: null }] });
 assert.equal(analyzed.timing[5][0].n, 1, 'Instagram timing uses Friday 00:30 in Casablanca, independent of device');
}
assert.equal(time.formatTimestamp('bad-date', 'en-GB'), '');
assert.equal(time.formatAppDate('2026-99-99', 'en-GB'), '');
assert.equal(time.formatDuration(3_900_000), '1h05');
assert.equal(time.formatClock(3_909_000), '1:05:09');
assert.equal(time.overlapMs({ start: '2026-10-01T10:00:00Z' }, Date.parse('2026-10-01T10:30:00Z'), Date.parse('2026-10-01T11:00:00Z')), 1_800_000);
for (const saved of [null, undefined, 'invalid', 'system', 'light', 'dark']) for (const systemDark of [true, false]) {
  const root = { dataset: {}, classList: { toggle(name, on) { this[name] = on; } } };
  runInNewContext(theme.themeBootstrap, { document: { documentElement: root }, localStorage: { getItem: () => saved }, matchMedia: () => ({ matches: systemDark }) });
  const preference = theme.themePreference(saved), dark = theme.isDarkTheme(preference, systemDark);
  assert.equal(root.dataset.theme, dark ? 'dark' : 'light'); assert.equal(root.classList.dark, dark);
  assert.equal(preference, saved === 'light' || saved === 'dark' ? saved : 'system');
}
// Older browsers can have stale Casablanca rules. The app's bundled IANA zone still wins.
const nativeFormatter = Intl.DateTimeFormat;
Intl.DateTimeFormat = function(locale, options) { return new nativeFormatter(locale, options?.timeZone === 'Africa/Casablanca' ? { ...options, timeZone: 'UTC' } : options); };
assert.equal(time.formatTimestamp('2026-10-01T10:35:00Z', 'en-GB', { hour: '2-digit', minute: '2-digit' }), '11:35');
assert.equal(time.appDayKey('2026-10-01T23:30:00Z'), '2026-10-02');
assert.equal(meetings.meetingStart({ due: '2026-10-01', time: '11:35' }).toISOString(), '2026-10-01T10:35:00.000Z');
Intl.DateTimeFormat = nativeFormatter;
for (const [instant, before, after] of [
 ['2026-02-15T02:00:00Z', '02:59', '02:00'],
 ['2026-03-22T02:00:00Z', '01:59', '03:00'],
]) {
 assert.equal(time.formatTimestamp(new Date(Date.parse(instant)-60_000), 'en-GB', { hour:'2-digit', minute:'2-digit' }), before);
 assert.equal(time.formatTimestamp(instant, 'en-GB', { hour:'2-digit', minute:'2-digit' }), after);
}
const root = { dataset: {}, classList: { toggle() {} } };
runInNewContext(theme.themeBootstrap, { document: { documentElement: root }, localStorage: { getItem() { throw Error('storage blocked'); } }, matchMedia: () => ({ matches: true }) });
assert.equal(root.dataset.theme, 'dark', 'blocked storage still follows system');
const roster = [
  { userId: 'o', name: 'Owner', role: 'owner' }, { userId: 'a', name: 'Admin', role: 'admin' },
  { userId: 'm', name: 'Assigned Member', role: 'creative' }, { userId: 'x', name: 'Other Member', role: 'creative' },
  { userId: 'c', name: 'Client Contact', role: 'client', clientId: 'c1' }, { userId: 'c2', name: 'Other Client', role: 'client', clientId: 'c2' },
  { userId: 'v', name: 'Viewer', role: 'viewer' },
];
const candidates = mentions.taskMentionCandidates({ assigneeId: 'm', assignee: 'Other Member', clientId: 'c1' }, roster);
assert.deepEqual(candidates.map(p => p.userId), ['o', 'a', 'm', 'c']);
assert.deepEqual(candidates.map(p => p.role), ['owner', 'admin', 'assignee', 'client']);
assert.ok(candidates.every(p => !('email' in p)));
assert.equal(mentions.taskMentionCandidates({ assignee: 'Assigned Member' }, roster).find(p => p.role === 'assignee').userId, 'm');
assert.ok(!mentions.taskMentionCandidates({ assignee: 'Assigned Member' }, [...roster, { userId: 'd', name: 'Assigned Member', role: 'creative' }]).some(p => p.role === 'assignee'));
const text = '👋 @Assigned Member, merci @Client Contact';
const spans = [{ userId: 'm', start: 3, end: 19 }, { userId: 'c', start: 27, end: 42 }];
// UTF-16 indices match textarea selections, including the emoji before the name.
spans[1].start = text.indexOf('@Client'); spans[1].end = text.length;
assert.deepEqual(mentions.validateMentions(spans, text, candidates).map(p => p.userId), ['m', 'c']);
for (const invalid of [[{ userId: 'x', start: 0, end: 1 }], [{ userId: 'm', start: 4, end: 19 }], [spans[0], spans[0]], Array(21).fill(spans[0]), 'm', [null]]) assert.ok('error' in mentions.validateMentions(invalid, text, candidates));
assert.deepEqual(mentions.validateMentions(undefined, 'email@domain.test and @Admin typed without selection', candidates), []);
assert.deepEqual(mentions.editMentions('@Owner ', 'Hi @Owner ', [{ userId: 'o', start: 0, end: 6 }]), [{ userId: 'o', start: 3, end: 9 }]);
assert.deepEqual(mentions.editMentions('@Owner ', '@OwXner ', [{ userId: 'o', start: 0, end: 6 }]), []);
assert.deepEqual(mentions.editMentions('@Alex @Alex', '@Alex', [{ userId: 'first', start: 0, end: 5 }, { userId: 'second', start: 6, end: 11 }], { start: 0, end: 6 }), [{ userId: 'second', start: 0, end: 5 }]);
assert.deepEqual(mentions.mentionQuery('Hi @Client Co', 13), { start: 3, end: 13, query: 'Client Co' });
assert.equal(mentions.mentionQuery('user@example.test', 17), null);
// A client reads times on their own clock; the studio's days and deadlines never move.
{
  const hm = { hour: '2-digit', minute: '2-digit' }, at = '2026-10-06T18:43:00Z';
  assert.equal(time.formatTimestamp(at, 'en-GB', hm), '19:43', 'studio: Casablanca');
  assert.equal(time.timeZoneLabel(at), 'Casablanca');
  time.setDisplayTimeZone('UTC'); // no browser here: ignored, still Casablanca
  assert.equal(time.formatTimestamp(at, 'en-GB', hm), '19:43', 'never changes on the server');
  globalThis.window = {};
  time.setDisplayTimeZone('UTC');
  assert.equal(time.formatTimestamp(at, 'en-GB', hm), '18:43', 'a client in UTC+0 sees 18:43');
  assert.equal(time.timeZoneLabel(at), 'UTC');
  time.setDisplayTimeZone('Europe/Paris');
  assert.equal(time.formatTimestamp(at, 'en-GB', hm), '20:43', 'a client in Paris sees 20:43');
  assert.equal(time.displayDayKey('2026-10-06T23:30:00Z'), '2026-10-07', 'chat days follow the reader');
  assert.equal(time.appDayKey('2026-10-06T23:30:00Z'), '2026-10-07', 'the studio day is Casablanca’s');
  assert.equal(time.appDayKey('2026-10-06T22:30:00Z'), '2026-10-06', 'the business day ignores the reader’s zone');
  assert.equal(time.displayDayKey('2026-10-06T22:30:00Z'), '2026-10-07', 'while the reader’s day moves with their clock');
  time.setDisplayTimeZone('Not/AZone');
  assert.equal(time.formatTimestamp(at, 'en-GB', hm), '19:43', 'an invalid zone falls back to Casablanca');
  time.setDisplayTimeZone(undefined); delete globalThis.window;
  assert.equal(time.formatTimestamp(at, 'en-GB', hm), '19:43');
}
console.log('Time, theme and mention checks passed: device zones, Ramadan, periods, meetings, preferences, scoped participants and edit identities.');
