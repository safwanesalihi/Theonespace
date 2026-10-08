// Benchmark: what the studio derives from the records on each render of the task board, before and
// after the refactor, on a large generated workspace. Not part of `pnpm test`.
// Usage: node scripts/bench/task-list.mjs [tasks=5000]
import { globSync, mkdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const esbuild = await import(pathToFileURL(globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0]));
mkdirSync('.sites-runtime', { recursive: true });
await esbuild.build({ stdin: { contents: "export * from './features/tasks/model'; export { compareTasks } from './lib/task-sort'; export { courtOf } from './lib/flow';", resolveDir: process.cwd() }, outfile: '.sites-runtime/bench-task-list.mjs', bundle: true, platform: 'node', format: 'esm' });
const { archivedIndex, commentCounts, filterTasks, compareTasks, courtOf } = await import(pathToFileURL(process.cwd() + '/.sites-runtime/bench-task-list.mjs'));

// ----- a generated workspace -----
const taskCount = Number(process.argv[2] ?? 5000);
let seed = 42;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (list) => list[Math.floor(random() * list.length)];
const today = '2026-10-08';
const day = (n) => new Date(Date.parse(`${today}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const records = [], members = [];
for (let m = 0; m < 25; m++) members.push({ userId: `u${m}`, name: `Person ${m}`, email: `p${m}@studio.test`, role: m ? 'creative' : 'owner', avatar: null });
for (let c = 0; c < 120; c++) records.push({ id: `c${c}`, kind: 'client', name: `Client ${c}`, archived: c % 15 === 14, createdAt: today, revision: 1 });
for (let p = 0; p < 600; p++) records.push({ id: `p${p}`, kind: 'project', name: `Projet ${p}`, clientId: `c${p % 120}`, archived: p % 20 === 19, createdAt: today, revision: 1 });
for (let t = 0; t < taskCount; t++) records.push({ id: `t${t}`, kind: 'task', name: `Tâche ${t}`, clientId: `c${t % 120}`, projectId: `p${t % 600}`, status: pick(['À faire', 'En cours', 'En pause', 'À valider', 'Validé']), assignee: `Person ${t % 25}`, due: day((t % 60) - 20), createdAt: today, revision: 1 });
for (let i = 0; i < taskCount * 3; i++) records.push({ id: `m${i}`, kind: 'comment', name: 'x', taskId: `t${i % taskCount}`, createdAt: today, revision: 1 });
for (let i = 0; i < 2000; i++) records.push({ id: `evt:${i}`, kind: 'event', name: 'x', createdAt: today, revision: 1 });
const filters = { showArchived: false, route: { page: 'tasks', tab: 'all' }, statusFilter: '', assigneeFilter: '', courtFilter: '', query: 'client 1', sort: 'status' };
const memberName = (m) => m.name || m.email || '';

// ----- before: the tracker's inline derivations, recomputed on every render -----
function before() {
  const clients = records.filter((r) => r.kind === 'client'), projects = records.filter((r) => r.kind === 'project');
  const archived = (r) => !!r.archived || !!clients.find((c) => c.id === r.clientId)?.archived || !!projects.find((p) => p.id === r.projectId)?.archived;
  const tasks = records.filter((r) => r.kind === 'task' && !archived(r));
  const allTasks = records.filter((r) => r.kind === 'task');
  const cname = (id) => (id === 'internal' ? 'Agence' : clients.find((c) => c.id === id)?.name || 'Client');
  const avatarOf = (name) => (name ? members.find((m) => memberName(m) === name || m.email === name)?.avatar : undefined);
  let list = allTasks.filter((t) => (filters.showArchived ? archived(t) : !archived(t)));
  if (filters.query) list = list.filter((t) => `${t.name} ${cname(t.clientId)} ${t.assignee}`.toLowerCase().includes(filters.query.toLowerCase()));
  const filtered = list.sort((a, b) => compareTasks(a, b, filters.sort, 'fr-FR'));
  // The board: each card counted its comments over every record, and looked up its client and avatar.
  let sink = tasks.length;
  for (const t of filtered) sink += records.filter((r) => r.kind === 'comment' && r.taskId === t.id).length + (avatarOf(t.assignee) ? 1 : 0) + cname(t.clientId).length + courtOf(t).length;
  return sink;
}

// ----- after: features/tasks/model.ts and the maps of features/studio/use-studio-model.tsx -----
function after() {
  const clients = records.filter((r) => r.kind === 'client');
  const archived = archivedIndex(records);
  const allTasks = records.filter((r) => r.kind === 'task');
  const tasks = allTasks.filter((r) => !archived(r));
  const clientsById = new Map(); for (const c of clients) if (!clientsById.has(c.id)) clientsById.set(c.id, c);
  const membersByName = new Map(); for (const m of members) for (const k of [memberName(m), m.email]) if (k && !membersByName.has(k)) membersByName.set(k, m);
  const cname = (id) => (id === 'internal' ? 'Agence' : (id && clientsById.get(id)?.name) || 'Client');
  const avatarOf = (name) => (name ? membersByName.get(name)?.avatar : undefined);
  const filtered = filterTasks(allTasks, filters, { archived, cname, tag: 'fr-FR' });
  const counts = commentCounts(records);
  let sink = tasks.length;
  for (const t of filtered) sink += (counts.get(t.id) ?? 0) + (avatarOf(t.assignee) ? 1 : 0) + cname(t.clientId).length + courtOf(t).length;
  return sink;
}

function time(fn, runs) {
  fn(); // warm up
  const samples = [];
  for (let i = 0; i < runs; i++) { const start = performance.now(); fn(); samples.push(performance.now() - start); }
  samples.sort((a, b) => a - b);
  return { median: samples[Math.floor(samples.length / 2)], min: samples[0] };
}
if (before() !== after()) throw new Error('before and after disagree');
const runs = taskCount > 2000 ? 5 : 20;
const b = time(before, runs), a = time(after, runs);
const shown = filterTasks(records.filter((r) => r.kind === 'task'), filters, { archived: archivedIndex(records), cname: (id) => records.find((r) => r.id === id)?.name ?? '', tag: 'fr-FR' }).length;
console.log(`${records.length} records (${taskCount} tasks, ${taskCount * 3} comments), ${shown} tasks on the board`);
console.log(`before: median ${b.median.toFixed(1)} ms (min ${b.min.toFixed(1)})`);
console.log(`after:  median ${a.median.toFixed(1)} ms (min ${a.min.toFixed(1)})`);
console.log(`speed-up: ${(b.median / a.median).toFixed(1)}×; and a render that changes no records reuses the memoized result instead of recomputing it.`);
