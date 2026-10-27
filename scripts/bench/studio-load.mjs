// What the studio's page costs the server: GET /api/records on a generated agency of three sizes.
// Counts the database queries and rows behind one load and one unchanged poll (the 304 every open
// tab sends each 5 s), and the payload size. Run: node scripts/bench/studio-load.mjs
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from '../../tests/helpers/pg.mjs';

const esbuild = await import(pathToFileURL(globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0]));
mkdirSync('.sites-runtime', { recursive: true });
await esbuild.build({ entryPoints: ['app/api/records/route.ts'], outfile: '.sites-runtime/bench-studio-load.mjs', bundle: true, platform: 'node', format: 'esm', logLevel: 'error', plugins: [testRuntimePlugin({ auth: false })] });
globalThis.testEnv = { OWNER_EMAIL: 'owner@example.com' };
globalThis.testUser = { userId: 'owner-a', fullName: 'Owner', displayName: 'Owner', email: 'owner@example.com' };
const { GET } = await import(pathToFileURL(process.cwd() + '/.sites-runtime/bench-studio-load.mjs'));

const day = 86_400_000;
const iso = (ms) => new Date(ms).toISOString();
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function agency(tasks) {
  const { db, pg } = await createTestDb();
  const stats = { queries: 0, rows: 0 };
  const counted = (inner) => ({
    async query(text, params) { const rows = await inner.query(text, params); stats.queries++; stats.rows += rows.length; return rows; },
    transaction: (fn) => inner.transaction((tx) => fn(counted(tx))),
  });
  globalThis.testDb = counted(db);
  await GET(new Request('https://tracker.test/api/records')); // creates the owner's workspace
  const ws = 'ws:owner-a', now = Date.now();
  const clients = Math.max(5, Math.round(tasks / 50));
  const rows = [];
  const add = (id, kind, data) => rows.push([id, kind, JSON.stringify({ id, kind, ...data })]);
  for (let c = 0; c < clients; c++) add(`c${c}`, 'client', { name: `Client ${c}`, createdAt: iso(now - 400 * day), quota: '12' });
  for (let t = 0; t < tasks; t++) {
    const age = (t / tasks) * 365 * day; // a year of history
    const status = t % 5 === 0 ? 'En cours' : t % 5 === 1 ? 'À faire' : 'Validé';
    const at = iso(now - age);
    add(`t${t}`, 'task', { name: `Reel ${t}`, clientId: `c${t % clients}`, status, createdAt: at, due: at.slice(0, 10),
      ...(status === 'Validé' ? { validatedAt: iso(now - Math.min(age, 10 * day)), archived: age > 30 * day } : {}),
      history: Array.from({ length: 12 }, (_, i) => ({ text: `Étape ${i}`, date: at })) });
    for (let m = 0; m < 3; m++) add(`m${t}-${m}`, 'comment', { taskId: `t${t}`, text: 'Un message de suivi sur ce contenu, avec quelques détails.', createdAt: at });
    for (let e = 0; e < 4; e++) add(`e${t}-${e}`, 'event', { taskId: `t${t}`, name: 'Notification', type: 'reminder', audience: 'studio', createdAt: at });
  }
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    await pg.query(`INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ${chunk.map((_, j) => `($${j * 3 + 1}, 'owner-a', '${ws}', $${j * 3 + 2}, $${j * 3 + 3}::jsonb, 1)`).join(',')}`, chunk.flat());
  }
  return { stats, total: rows.length + 0 };
}

async function measure(tasks) {
  const { stats, total } = await agency(tasks);
  const run = async (headers = {}) => {
    stats.queries = 0; stats.rows = 0;
    const start = performance.now();
    const res = await GET(new Request('https://tracker.test/api/records', { headers }));
    const body = res.status === 304 ? '' : await res.text();
    return { ms: performance.now() - start, status: res.status, bytes: body.length, etag: res.headers.get('ETag'), queries: stats.queries, rows: stats.rows };
  };
  const first = await run(); // the sweep may archive old work here, as in production after a long gap
  const loads = []; for (let i = 0; i < 5; i++) loads.push(await run());
  const etag = loads.at(-1).etag;
  const polls = []; for (let i = 0; i < 5; i++) polls.push(await run({ 'If-None-Match': etag }));
  return { tasks, records: total, first: Math.round(first.ms), load: Math.round(median(loads.map((l) => l.ms))), poll: Math.round(median(polls.map((p) => p.ms))),
    pollStatus: polls[0].status, payloadKb: Math.round(loads[0].bytes / 1024), loadQueries: loads[0].queries, pollQueries: polls[0].queries, pollRows: polls[0].rows };
}

const results = [];
for (const tasks of [300, 1500, 4000]) results.push(await measure(tasks));
console.table(results);
console.log(JSON.stringify(results));
