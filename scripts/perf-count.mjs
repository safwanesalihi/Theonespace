// How many database round trips each request of the workspace makes, and how long it takes when every one costs
// RTT ms (a function in one region, its database in another). Local PGlite only: nothing is touched elsewhere.
// Run from the repo root: node scripts/perf-count.mjs 100 [trace]   (0 = same machine, 100 = across the Atlantic).
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from '../tests/helpers/pg.mjs';

const RTT = Number(process.argv[2] ?? 60);
const esbuild = await import(pathToFileURL(globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0]));
mkdirSync('.sites-runtime/perf', { recursive: true });
await esbuild.build({
  entryPoints: { signup: 'app/api/auth/signup/route.ts', password: 'app/api/auth/password/route.ts', records: 'app/api/records/route.ts' },
  outdir: '.sites-runtime/perf', outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node', format: 'esm', external: ['nodemailer'],
  plugins: [testRuntimePlugin({ auth: true })],
});
const { db, pg } = await createTestDb();
let count = 0, trace = false, T0 = 0; const seen = [];
const wave = () => `w${String(Math.round((performance.now() - T0) / (RTT || 1))).padStart(2)}`;
const counted = {
  async query(text, params) { count++; if (trace) seen.push(wave() + ' ' + text.replace(/\s+/g, ' ').slice(0, 84)); if (RTT) await new Promise((r) => setTimeout(r, RTT)); return db.query(text, params); },
  async transaction(fn) { count++; if (RTT) await new Promise((r) => setTimeout(r, RTT)); return db.transaction(async (tx) => fn({ query: async (t, p) => { count++; if (trace) seen.push(wave() + '  tx ' + t.replace(/\s+/g, ' ').slice(0, 80)); if (RTT) await new Promise((r) => setTimeout(r, RTT)); return tx.query(t, p); }, transaction: tx.transaction })); },
};
globalThis.testDb = db; // set up fast, measure with the counted one
const origin = 'https://localhost';
globalThis.testEnv = { AUTH_URL: origin, OWNER_EMAIL: 'contact@the1core.com', OWNER_PASSWORD: 'TOC-owner-test-password', PUBLIC_SIGNUP: 'on' };
const load = (n) => import(pathToFileURL(`${process.cwd()}/.sites-runtime/perf/${n}.mjs`));
const [signup, records] = await Promise.all(['signup', 'records'].map(load));
let ip = 1;
const cookieOf = (r) => r.headers.getSetCookie().find((c) => c.startsWith('__Host-the-one.session='))?.split(';')[0];
const auth = async (body) => { const r = await signup.POST(new Request(origin + '/api/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json', origin, 'x-vercel-forwarded-for': `198.51.100.${ip++}` }, body: JSON.stringify(body) })); return { data: await r.json(), cookie: cookieOf(r) }; };
const s = await auth({ action: 'start', company: 'Perf Co', name: 'Owner', email: 'o@perf.test', password: 'company-password-2026' });
const v = await auth({ action: 'verify', email: 'o@perf.test', code: s.data.devCode, password: 'company-password-2026' });
const cookie = v.cookie, ws = v.data.workspaceId;
const post = async (body) => { const r = await records.POST(new Request(origin + '/api/records', { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json', 'X-Workspace-Id': ws }, body: JSON.stringify(body) })); const d = await r.json(); assert.equal(r.status, 200, JSON.stringify(d).slice(0, 200)); return { d, bytes: JSON.stringify(d).length }; };
const day = (o) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + o); return d.toISOString().slice(0, 10); };
// A studio with some history: 5 clients, 120 tasks.
const clients = [];
for (let i = 0; i < 5; i++) clients.push((await post({ action: 'create', kind: 'client', data: { name: `Client ${i}` } })).d.id);
for (let i = 0; i < 120; i++) await post({ action: 'create', kind: 'task', data: { name: `Tâche ${i}`, clientId: clients[i % 5], due: day(30 + (i % 20)), source: 'Interne' } });

globalThis.testDb = counted;
const get = (extra = {}) => records.GET(new Request(origin + '/api/records', { headers: { cookie, 'X-Workspace-Id': ws, ...extra } }));
async function measure(label, fn) {
  count = 0; seen.length = 0; trace = true; const t0 = performance.now(); T0 = t0;
  const bytes = await fn();
  const ms = performance.now() - t0; trace = false;
  console.log(`${label.padEnd(34)} ${String(count).padStart(3)} queries  ${ms.toFixed(0).padStart(5)} ms  ${bytes ? (bytes / 1024).toFixed(0) + ' KB' : ''}`);
  return seen.slice();
}
// warm up (module loading, first-use tables)
await get(); await get();
let etag, firstQueries;
firstQueries = await measure('GET full load (page open)', async () => { const r = await get(); etag = r.headers.get('etag'); return (await r.text()).length; });
await measure('GET poll, nothing changed (304)', async () => { const r = await get({ 'if-none-match': etag }); await r.text(); return 0; });
const created = await measure('POST create a task', async () => (await post({ action: 'create', kind: 'task', data: { name: 'Nouvelle', clientId: clients[0], due: day(40), source: 'Interne' } })).bytes);
const one = (await (await get()).json()).records.find((r) => r.name === 'Nouvelle');
const upd = await measure('POST update a task', async () => (await post({ action: 'update', kind: 'task', id: one.id, revision: one.revision, data: { name: 'Nouvelle', clientId: clients[0], due: day(41), source: 'Interne' } })).bytes);
console.log(`\nRTT simulated per query: ${RTT} ms`);
if (process.argv[3] === 'trace') { console.log('\n--- full load queries'); firstQueries.forEach((q, i) => console.log(String(i + 1).padStart(2), q)); console.log('\n--- create queries'); created.forEach((q, i) => console.log(String(i + 1).padStart(2), q)); console.log('\n--- update queries'); upd.forEach((q, i) => console.log(String(i + 1).padStart(2), q)); }
await pg.close();
process.exit(0);
