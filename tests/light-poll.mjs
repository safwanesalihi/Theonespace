// The page poll stays cheap: an unchanged poll answers 304 from a small stamp query without reading the
// workspace, any change the page shows makes the next poll load again, and the sweep's daily notices
// no longer make every load read the workspace twice (features/records/server/pipeline.ts pageLoad).
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';

const esbuild = await import(pathToFileURL(globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0]));
mkdirSync('.sites-runtime', { recursive: true });
await esbuild.build({ entryPoints: ['app/api/records/route.ts'], outfile: '.sites-runtime/light-poll-test.mjs', bundle: true, platform: 'node', format: 'esm', logLevel: 'error', plugins: [testRuntimePlugin({ auth: false })] });
const { db, pg } = await createTestDb();
const reads = [];
globalThis.testDb = {
  async query(text, params) { if (/FROM records WHERE workspace_id = \$1 AND kind != 'meta'/.test(text)) reads.push(text); return db.query(text, params); },
  transaction: (fn) => db.transaction(fn),
};
globalThis.testEnv = { OWNER_EMAIL: 'owner@example.com' };
globalThis.testUser = { userId: 'owner-a', fullName: 'Owner', displayName: 'Owner', email: 'owner@example.com' };
const { GET } = await import(pathToFileURL(process.cwd() + '/.sites-runtime/light-poll-test.mjs'));

let assertions = 0;
const get = (etag) => GET(new Request('https://tracker.test/api/records', { headers: etag ? { 'If-None-Match': etag } : {} }));
const ws = 'ws:owner-a';
const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const insert = (id, kind, data) => pg.query("INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ($1, 'owner-a', $2, $3, $4::jsonb, 1)", [id, ws, kind, JSON.stringify({ id, kind, createdAt: new Date().toISOString(), ...data })]);

// The first load creates the workspace; a client and a task publishing tomorrow, not approved: the sweep
// writes its J−1 and J−7 notices once.
let res = await get();
assert.equal(res.status, 200); assertions++;
await insert('c1', 'client', { name: 'Kojo' });
await insert('t1', 'task', { name: 'Reel', clientId: 'c1', status: 'En cours', due: day(1) });

reads.length = 0;
res = await get();
assert.equal(res.status, 200); assertions++;
assert.equal(reads.length, 2, 'the load that writes the notices reads again once'); assertions++;
const notices = await pg.query("SELECT id FROM records WHERE workspace_id = $1 AND kind = 'event'", [ws]);
assert.ok(notices.rows.length >= 1, 'the J−1 notice exists'); assertions++;

reads.length = 0;
res = await get();
let etag = res.headers.get('ETag');
assert.equal(res.status, 200); assertions++;
assert.equal(reads.length, 1, 'notices already stored are not changes: one read, not two'); assertions++;
assert.ok(etag?.startsWith('W/"s-'), 'the ETag is the change stamp'); assertions++;

// Nothing changed: 304, and the workspace is not read.
reads.length = 0;
res = await get(etag);
assert.equal(res.status, 304); assertions++;
assert.equal(reads.length, 0, 'an unchanged poll never reads the workspace'); assertions++;
assert.equal(res.headers.get('ETag'), etag); assertions++;

// A new record: the next poll loads.
await insert('t2', 'task', { name: 'Post', clientId: 'c1', status: 'À faire' });
res = await get(etag);
assert.equal(res.status, 200); assertions++;
const body = await res.json();
assert.ok(body.records.some((r) => r.id === 't2')); assertions++;
const etag2 = res.headers.get('ETag');
assert.notEqual(etag2, etag); assertions++;
etag = etag2;

// A write that keeps `revision` (receipts, publish results, statistics) still changes the stamp.
await pg.query("UPDATE records SET data = jsonb_set(data, '{name}', '\"Post final\"') WHERE id = 't2' AND workspace_id = $1", [ws]);
res = await get(etag);
assert.equal(res.status, 200); assertions++;
assert.equal((await res.json()).records.find((r) => r.id === 't2').name, 'Post final'); assertions++;
etag = res.headers.get('ETag');

// A deletion changes it.
await pg.query("DELETE FROM records WHERE id = 't2' AND workspace_id = $1", [ws]);
res = await get(etag);
assert.equal(res.status, 200); assertions++;
etag = res.headers.get('ETag');

// The roster: a new member, then a changed role.
await pg.query("INSERT INTO workspace_members (workspace_id, user_id, role, name, email, created_at) VALUES ($1, 'm1', 'creative', 'Salma', 'salma@example.com', now())", [ws]);
res = await get(etag);
assert.equal(res.status, 200); assertions++;
etag = res.headers.get('ETag');
await pg.query("UPDATE workspace_members SET role = 'admin' WHERE workspace_id = $1 AND user_id = 'm1'", [ws]);
res = await get(etag);
assert.equal(res.status, 200); assertions++;
etag = res.headers.get('ETag');

// Unchanged again: 304.
res = await get(etag);
assert.equal(res.status, 304); assertions++;

// A stale or foreign ETag never gets a 304.
res = await get('W/"something-else"');
assert.equal(res.status, 200); assertions++;

console.log(`light poll: ${assertions} assertions passed`);
