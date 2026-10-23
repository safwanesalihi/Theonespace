// Reports (lib/reports.ts): time cut to the period and working hours per task, client, person and format, the time one
// approved content took, the pace from creation to approval, on-time approvals and running clocks.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const esbuild = await import(pathToFileURL(globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0] || 'node_modules/esbuild/lib/main.js'));
mkdirSync('.sites-runtime', { recursive: true });
await esbuild.build({ stdin: { contents: "export * from './lib/reports'; export { monthPeriod } from './lib/flow';", resolveDir: process.cwd() }, outfile: '.sites-runtime/reports-test.mjs', bundle: true, platform: 'node', format: 'esm', logLevel: 'error' });
const { workReport, workingMs, taskFormat, monthPeriod } = await import(pathToFileURL(process.cwd() + '/.sites-runtime/reports-test.mjs'));

let checks = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const H = 3_600_000;
const entry = (name, start, hours) => ({ userId: name.toLowerCase(), name, start, end: new Date(Date.parse(start) + hours * H).toISOString() });
const task = (id, extra) => ({ id, kind: 'task', revision: 1, name: id, status: 'À faire', createdAt: '2026-09-01T09:00:00.000Z', ...extra });
const records = [
  { id: 'c1', kind: 'client', revision: 1, name: 'Atlas', createdAt: '2026-01-01T00:00:00.000Z' },
  // A reel: two hours in September, one hour in August; approved before its due day.
  task('A', { clientId: 'c1', scopeFormat: 'reel', status: 'Validé', validatedAt: '2026-09-10T09:00:00.000Z', due: '2026-09-12',
    timeEntries: [entry('Ali', '2026-09-02T08:00:00.000Z', 2), entry('Sara', '2026-08-31T08:00:00.000Z', 1)] }),
  task('B', { clientId: 'c1', postType: 'post', status: 'En cours', timeEntries: [entry('Ali', '2026-09-03T08:00:00.000Z', 0.5)] }),
  // Internal work, approved after its due day.
  task('C', { createdAt: '2026-09-05T09:00:00.000Z', status: 'Validé', validatedAt: '2026-09-20T09:00:00.000Z', due: '2026-09-15', timeEntries: [entry('Sara', '2026-09-07T08:00:00.000Z', 1)] }),
  // Approved without a clock: it counts as approved, not in the time per content.
  task('D', { clientId: 'c1', status: 'Validé', validatedAt: '2026-09-03T09:00:00.000Z' }),
];
const now = Date.parse('2026-10-05T12:00:00.000Z');
const r = workReport(records, monthPeriod('2026-09-14'), now);

eq([r.loggedMs, r.timedTasks], [3.5 * H, 3], 'time cut to the month: August’s hour is left out');
eq(r.tasks.map((t) => [t.task.id, t.ms, t.totalMs, t.people]), [['A', 2 * H, 3 * H, ['Ali']], ['C', H, H, ['Sara']], ['B', 0.5 * H, 0.5 * H, ['Ali']]], 'per task: the period, the total, who');
eq([r.approved, r.approvedTimed, r.perApproved], [3, 2, 2 * H], 'a content’s whole time, averaged over the approved ones with a clock');
eq(r.cycleDays, 9, 'median days from creation to approval (2, 9, 15)');
eq([r.onTime, r.dated, r.onTimeShare], [1, 2, 0.5], 'on time against the due day');
eq(r.clients.map((g) => [g.label, g.ms, g.tasks, g.approved, g.perApproved]), [['Atlas', 2.5 * H, 2, 2, 3 * H], ['Interne', H, 1, 1, H]], 'per client, internal work apart');
eq(r.formats.map((g) => [g.key, g.ms, g.approved]), [['reel', 2 * H, 1], ['other', H, 2], ['post', 0.5 * H, 0]], 'per format, from the task’s format');
eq(r.people.map((p) => [p.label, p.ms, p.tasks]), [['Ali', 2.5 * H, 2], ['Sara', H, 1]], 'per person, from the entries');

// A clock still running counts up to now, and the whole history takes every hour.
const running = [...records, task('E', { timeEntries: [{ userId: 'ali', name: 'Ali', start: new Date(now - H).toISOString() }] })];
const all = workReport(running, null, now);
eq([all.loggedMs, all.running], [5.5 * H, 1], 'since the start, with the running clock');
eq(workReport([], monthPeriod('2026-09-14'), now).perApproved, null, 'nothing approved, no average');

// Tasks made by hand carry no format: it is read from the title.
eq(['Carrousel : rentrée', 'Reel: the weaver at work', 'Story — offre', 'Shooting lookbook', 'Webinar replay edit'].map((name) => taskFormat(task('x', { name }))), ['carousel', 'reel', 'story', 'shooting', 'other'], 'format from the title');
eq(taskFormat(task('x', { name: 'Reel', scopeFormat: 'post' })), 'post', 'a planned format wins over the title');

// Working hours only: a clock left running from Saturday 18:00 to Monday 10:00 (Casablanca) counts the
// Saturday evening and the Monday morning, never the night nor the Sunday.
const weekend = { userId: 'ali', name: 'Ali', start: '2026-10-03T17:00:00.000Z', end: '2026-10-05T09:00:00.000Z' };
eq(workingMs(weekend, 0, now), 4 * H, 'two hours on Saturday, two on Monday');

console.log(`${checks} report checks passed: time per task, client, person and format, time per approved content, production time, on-time approvals and running clocks.`);
