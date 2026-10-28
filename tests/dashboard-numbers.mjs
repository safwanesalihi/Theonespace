// A studio picks the numbers on its dashboard (lib/dashboard.ts, lib/process.ts dashboard): six at most,
// from the library or the total of one of its number or amount fields, each against its own target.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const esbuild = await import(pathToFileURL(globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0]));
mkdirSync('.sites-runtime', { recursive: true });
await esbuild.build({ stdin: { contents: "export * from './lib/dashboard'; export { processSchema, readProcess, oneCoreProcess } from './lib/process';", resolveDir: process.cwd() }, outfile: '.sites-runtime/dashboard-numbers-lib.mjs', bundle: true, platform: 'node', format: 'esm', logLevel: 'error' });
const lib = await import(pathToFileURL(process.cwd() + '/.sites-runtime/dashboard-numbers-lib.mjs'));

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const issues = (p) => { const r = lib.processSchema.safeParse(p); return r.success ? [] : r.error.issues.map((i) => i.message); };

const fields = [
  { id: 'budget', label: 'Budget pub', type: 'money', unit: 'MAD' },
  { id: 'reach', label: 'Portée', type: 'number' },
  { id: 'hook', label: 'Accroche', type: 'text' },
];
const studio = (metrics, more = {}) => ({ ...lib.oneCoreProcess, fields, dashboard: { metrics }, ...more });

// ----- the rules -----
eq(lib.dashboardOf(lib.oneCoreProcess).map((m) => m.id), ['onTime', 'approvalHours', 'silence', 'rounds', 'deliveredVsSold', 'evergreen'], 'no choice: The One Flow’s six');
eq(issues(studio([{ id: 'delivered', target: 20 }, { id: 'field:budget', target: 5000, atMost: true }, { id: 'hours' }])), [], 'library, field totals, no target');
ok(issues(studio(['onTime', 'approvalHours', 'silence', 'rounds', 'deliveredVsSold', 'evergreen', 'delivered'].map((id) => ({ id })))).includes('Six chiffres au plus sur le tableau de bord.'), 'six at most');
ok(issues(studio([{ id: 'onTime' }, { id: 'onTime' }])).includes('Le même chiffre apparaît deux fois sur le tableau de bord.'), 'no duplicate');
const missing = 'Un chiffre du tableau de bord n’existe pas (ou son champ n’est plus un nombre).';
ok(issues(studio([{ id: 'happiness' }])).includes(missing), 'only the library');
ok(issues(studio([{ id: 'field:hook' }])).includes(missing), 'a text field has no total');
ok(issues(studio([{ id: 'field:nope' }])).includes(missing), 'nor a field that doesn’t exist');
ok(issues(studio([{ id: 'onTime', target: -1 }])).length > 0, 'targets are positive');

// A field deleted since: its total leaves the dashboard, the rest stays.
const read = lib.readProcess({ ...studio([{ id: 'field:reach', target: 1000 }, { id: 'delivered', target: 4 }]), fields: fields.filter((f) => f.id !== 'reach') });
eq(read.dashboard.metrics, [{ id: 'delivered', target: 4 }], 'a removed field’s total is dropped, not the studio’s process');

// ----- the numbers -----
const period = { from: '2026-10-01', to: '2026-10-31' };
const task = (id, extra) => ({ id, kind: 'task', name: id, status: 'Validé', createdAt: '2026-10-02T09:00:00.000Z', updatedAt: '2026-10-02T09:00:00.000Z', ...extra });
const records = [
  { id: 'c1', kind: 'client', name: 'Kojo', quota: '4', createdAt: '2026-09-01T09:00:00.000Z' },
  task('t1', { clientId: 'c1', due: '2026-10-10', publishedAt: '2026-10-09T10:00:00.000Z', sentAt: '2026-10-05T10:00:00.000Z', signOff: { mode: 'explicit', at: '2026-10-06T10:00:00.000Z' }, revisionRound: 1, fields: { budget: 1200, reach: 800 } }),
  task('t2', { clientId: 'c1', due: '2026-10-12', publishedAt: '2026-10-14T10:00:00.000Z', signOff: { mode: 'silence', at: '2026-10-11T10:00:00.000Z' }, fields: { budget: 4300.5 } }),
  task('t3', { clientId: 'c1', due: '2026-11-03', fields: { budget: 999 } }), // next month: not in October's total
  task('t4', { clientId: 'c1', status: 'En cours', due: '2026-10-20', timeEntries: [{ userId: 'u1', name: 'Lina', start: '2026-10-07T09:00:00.000Z', end: '2026-10-07T11:00:00.000Z' }] }),
];
const byId = (list) => Object.fromEntries(list.map((m) => [m.id, m]));

let n = byId(lib.computeDashboard(records, period, lib.oneCoreProcess, Date.parse('2026-10-27T12:00:00Z')));
eq([n.onTime.value, n.onTime.target, n.onTime.state], [0.5, 0.95, 'watch'], 'one of two published on time, against 95 %');
eq([n.approvalHours.value, n.approvalHours.state], [24, 'good'], 'a day to approve: at most the 24 h target');
eq([n.silence.value, n.silence.atMost, n.silence.state], [0.5, true, 'watch'], 'half approved by silence: more than 30 %');
eq([n.rounds.value, n.rounds.state], [0.5, 'good']);
eq([n.deliveredVsSold.value, n.deliveredVsSold.state], [0.5, 'watch'], 'two delivered for four sold');

n = byId(lib.computeDashboard(records, period, studio([{ id: 'field:budget', target: 5000, atMost: true }, { id: 'field:reach' }, { id: 'delivered', target: 2 }, { id: 'hours', target: 10 }]), Date.parse('2026-10-27T12:00:00Z')));
eq([n['field:budget'].label, n['field:budget'].kind, n['field:budget'].unit, n['field:budget'].value, n['field:budget'].state], ['Budget pub', 'money', 'MAD', 5500.5, 'watch'], 'the budget spent in October, over its ceiling');
eq([n['field:reach'].value, n['field:reach'].target, n['field:reach'].state], [800, undefined, null], 'no target: no mark');
eq([n.delivered.value, n.delivered.state], [2, 'good'], 'at least the target');
eq([n.hours.value, n.hours.state], [2, 'watch'], 'the hours logged, in working hours');
eq(lib.computeDashboard([], period, studio([{ id: 'field:budget', target: 5000 }, { id: 'onTime', target: 0.9 }])).map((m) => [m.value, m.state]), [[null, null], [null, null]], 'nothing to measure: no mark');

console.log(`dashboard numbers: ${checks} checks passed`);
