// features/tasks/model.ts: the task list's rules. Each one is compared with the inline version the
// tracker used before it moved here (kept below as the reference), on generated workspaces.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const esbuild = await import(pathToFileURL(globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0]));
mkdirSync('.sites-runtime', { recursive: true });
await esbuild.build({ entryPoints: ['features/tasks/model.ts'], outfile: '.sites-runtime/task-model-test.mjs', bundle: true, platform: 'node', format: 'esm' });
const model = await import(pathToFileURL(process.cwd() + '/.sites-runtime/task-model-test.mjs'));
let assertions = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); assertions++; };

// ----- a deterministic generated workspace -----
let seed = 7;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (list) => list[Math.floor(random() * list.length)];
const statuses = ['À faire', 'En cours', 'En pause', 'À valider', 'Validé'];
const today = '2026-10-08';
const day = (offset) => new Date(Date.parse(`${today}T12:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
const records = [];
for (let c = 0; c < 12; c++) records.push({ id: `c${c}`, kind: 'client', name: `Client ${c}`, archived: c % 5 === 4, createdAt: today, revision: 1 });
for (let p = 0; p < 30; p++) records.push({ id: `p${p}`, kind: 'project', name: `Projet ${p}`, clientId: `c${p % 12}`, archived: p % 7 === 3, createdAt: today, revision: 1 });
const people = ['Ana', 'Badr', 'Chama', ''];
for (let t = 0; t < 400; t++) {
  const internal = t % 9 === 0;
  records.push({
    id: `t${t}`, kind: 'task', name: `Tâche ${pick(['affiche', 'reel', 'post', 'vidéo'])} ${t}`, revision: 1, createdAt: today,
    clientId: internal ? 'internal' : `c${t % 12}`, projectId: internal ? undefined : `p${t % 30}`,
    status: pick(statuses), assignee: pick(people) || undefined, assigneeId: t % 4 === 0 ? 'u-ana' : undefined,
    due: t % 6 === 0 ? undefined : day(Math.floor(random() * 30) - 10), archived: t % 23 === 0,
  });
}
for (let m = 0; m < 300; m++) records.push({ id: `m${m}`, kind: 'comment', name: 'x', taskId: `t${m % 50}`, createdAt: today, revision: 1 });
const clients = records.filter((r) => r.kind === 'client'), projects = records.filter((r) => r.kind === 'project');
const allTasks = records.filter((r) => r.kind === 'task');

// ----- the reference: the tracker's inline rules, before the refactor -----
const refArchived = (r) => !!r.archived || !!clients.find((c) => c.id === r.clientId)?.archived || !!projects.find((p) => p.id === r.projectId)?.archived;
const cname = (id) => (id === 'internal' ? 'Agence' : clients.find((c) => c.id === id)?.name || 'Client');

// archivedIndex: same answer as the scan, for every record.
const archived = model.archivedIndex(records);
eq(records.map(archived), records.map(refArchived), 'archived parents');

// commentCounts: the board used to count by filtering every record for every card.
const counts = model.commentCounts(records);
for (const t of allTasks) assert.equal(counts.get(t.id) ?? 0, records.filter((r) => r.kind === 'comment' && r.taskId === t.id).length);
assertions++;

// filterTasks: every page and filter combination gives the inline result, in the same order.
const routes = [{ page: 'tasks' }, { page: 'tasks', tab: 'all' }, { page: 'internal' }, { page: 'client', id: 'c3' }, { page: 'home' }];
for (const route of routes) for (const showArchived of [false, true]) for (const statusFilter of ['', 'À valider']) for (const query of ['', 'reel', 'client 1']) for (const sort of ['status', 'due', 'name']) {
  const filters = { showArchived, route, statusFilter, assigneeFilter: '', courtFilter: '', query, sort };
  const got = model.filterTasks(allTasks, filters, { archived, cname, tag: 'fr-FR' }).map((t) => t.id);
  let list = allTasks.filter((t) => (showArchived ? refArchived(t) : !refArchived(t)));
  if (route.page === 'client') list = list.filter((t) => t.clientId === route.id);
  if (route.page === 'internal') list = list.filter((t) => t.clientId === 'internal');
  if (route.page === 'tasks' && route.tab !== 'all') list = list.filter((t) => t.clientId !== 'internal');
  if (statusFilter) list = list.filter((t) => t.status === statusFilter);
  if (query) list = list.filter((t) => `${t.name} ${cname(t.clientId)} ${t.assignee}`.toLowerCase().includes(query.toLowerCase()));
  const rank = (t) => { const i = ['À valider', 'À faire', 'En cours', 'En pause', 'Validé'].indexOf(t.status || 'À faire'); return i < 0 ? 1 : i; };
  const byName = (a, b) => a.name.localeCompare(b.name, 'fr-FR') || a.id.localeCompare(b.id);
  const byDue = (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || byName(a, b);
  list.sort(sort === 'name' ? byName : sort === 'status' ? (a, b) => rank(a) - rank(b) || byDue(a, b) : byDue);
  eq(got, list.map((t) => t.id), `filter ${JSON.stringify(filters)}`);
}
// The other two filters narrow the list.
const byPerson = model.filterTasks(allTasks, { showArchived: false, route: { page: 'tasks', tab: 'all' }, statusFilter: '', assigneeFilter: 'Ana', courtFilter: '', query: '', sort: 'status' }, { archived, cname, tag: 'fr-FR' });
assert.ok(byPerson.length && byPerson.every((t) => t.assignee === 'Ana')); assertions++;
const byCourt = model.filterTasks(allTasks, { showArchived: false, route: { page: 'tasks', tab: 'all' }, statusFilter: '', assigneeFilter: '', courtFilter: 'client', query: '', sort: 'status' }, { archived, cname, tag: 'fr-FR' });
assert.ok(byCourt.length && byCourt.every((t) => t.status === 'À valider')); assertions++;

// quickTests: the chips.
const user = { id: 'u-ana', name: 'Ana', email: 'ana@studio.test' };
const quick = model.quickTests(user, today);
eq(quick.late({ due: day(-1), status: 'En cours' }), true, 'late');
eq(quick.late({ due: day(-1), status: 'Validé' }), false, 'approved is never late');
eq(quick.week({ due: day(6), status: 'À faire' }), true, 'within the week');
eq(quick.week({ due: day(7), status: 'À faire' }), false, 'past the week');
eq(quick.nodate({ status: 'À faire' }), true, 'undated');
eq(quick.mine({ assigneeId: 'u-ana' }), true, 'mine by id');
eq(quick.mine({ assigneeId: 'u-badr', assignee: 'Ana' }), false, 'an id wins over a name');
eq(quick.mine({ assignee: ' ana@studio.test ' }), true, 'mine by e-mail, older tasks');

// dueTone and the tracker's labels.
eq(model.dueTone({ due: undefined, status: 'À faire' }, today), { tone: 'none', days: null }, 'no date');
eq(model.dueTone({ due: day(-3), status: 'Validé' }, today), { tone: 'done', days: null }, 'done');
eq(model.dueTone({ due: day(-3), status: 'En cours' }, today), { tone: 'late', days: -3 }, 'late');
eq(model.dueTone({ due: today, status: 'En cours' }, today), { tone: 'today', days: 0 }, 'today');
eq(model.dueTone({ due: day(1) }, today), { tone: 'soon', days: 1 }, 'tomorrow');
eq(model.dueTone({ due: day(6) }, today), { tone: 'soon', days: 6 }, 'this week');
eq(model.dueTone({ due: day(7) }, today), { tone: 'later', days: 7 }, 'later');

// groupTasks: order and labels.
const tr = (text) => text;
const clientOf = (id) => clients.find((c) => c.id === id);
const sample = allTasks.slice(0, 60);
const byStatus = model.groupTasks(sample, 'status', { tr, cname, clientOf, today });
eq(byStatus.map((g) => g.key), ['À valider', 'À faire', 'En cours', 'En pause', 'Validé'].filter((s) => sample.some((t) => (t.status ?? 'À faire') === s)).map((s) => `s:${s}`), 'status groups in workflow order');
eq(byStatus.flatMap((g) => g.items).length, sample.length, 'every task in one group');
const byClient = model.groupTasks(sample, 'client', { tr, cname, clientOf, today });
eq(byClient[0].key, 'c:internal', 'internal tasks first');
eq(byClient[0].mark, null, 'no client mark for internal work');
const byDue = model.groupTasks(sample, 'due', { tr, cname, clientOf, today });
eq(byDue.map((g) => g.key), [...byDue.map((g) => g.key)].sort(), 'due buckets in order');
const byPersonGroups = model.groupTasks(sample, 'assignee', { tr, cname, clientOf, today });
eq(byPersonGroups.at(-1).label, 'Non assigné', 'unassigned last');

// timerTotals: closed spans plus the running one, biggest first.
const totals = model.timerTotals([
  { userId: 'a', name: 'Ana', start: '2026-10-08T08:00:00Z', end: '2026-10-08T09:00:00Z' },
  { userId: 'b', name: 'Badr', start: '2026-10-08T08:00:00Z', end: '2026-10-08T08:30:00Z' },
  { userId: 'a', name: 'Ana', start: '2026-10-08T10:00:00Z' },
], Date.parse('2026-10-08T10:15:00Z'));
eq(totals, [{ userId: 'a', name: 'Ana', ms: 75 * 60_000, running: true }, { userId: 'b', name: 'Badr', ms: 30 * 60_000, running: false }], 'timer totals');
eq(model.timerTotals(undefined, 0), [], 'no entries');

console.log(`task model: ${assertions} assertions passed`);
