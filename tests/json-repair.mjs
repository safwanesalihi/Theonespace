// Production (postgres.js) stored every record's data as a JSON string: its jsonb serializer encoded
// the JSON text the app passes a second time, and jsonb_set then failed on publish ("cannot set path in
// scalar"). The connection now passes JSON text through, and the rows already stored are repaired.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { createTestDb } from './helpers/pg.mjs';

const esbuildPath = globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0] || 'node_modules/esbuild/lib/main.js';
const esbuild = await import(pathToFileURL(esbuildPath));
mkdirSync('.sites-runtime', { recursive: true });
const bundle = async (entry, out) => {
  await esbuild.build({ entryPoints: [entry], outfile: `.sites-runtime/${out}`, bundle: true, platform: 'node', format: 'esm', external: ['postgres', '@electric-sql/pglite'] });
  return import(pathToFileURL(`${process.cwd()}/.sites-runtime/${out}`));
};
const { jsonType } = await bundle('lib/database.ts', 'json-database-test.mjs');
const { repairJsonRows } = await bundle('lib/json-repair.ts', 'json-repair-test.mjs');
let checks = 0;
const check = async (fn) => { await fn(); checks++; };

// 1. The serializer postgres.js picks for a json/jsonb parameter leaves JSON text alone.
const sql = postgres('postgres://nobody@127.0.0.1:1/none', { prepare: false, types: { json: jsonType } });
const text = JSON.stringify({ a: 1, b: ['x'] });
for (const oid of [114, 3802]) {
  await check(() => assert.equal(sql.options.serializers[oid](text), text, `oid ${oid}: text passes through`));
  await check(() => assert.equal(sql.options.serializers[oid]({ a: 1 }), '{"a":1}', `oid ${oid}: an object is still encoded`));
}
const stock = postgres('postgres://nobody@127.0.0.1:1/none', { prepare: false });
await check(() => assert.equal(stock.options.serializers[3802](text), JSON.stringify(text), 'the default double-encodes, which is the bug'));
await sql.end(); await stock.end();

// 2. Rows stored as JSON strings become objects; duplicate document numbers are split, oldest first.
const { db, pg } = await createTestDb();
await pg.query("INSERT INTO workspaces (id, name, created_by) VALUES ('ws', 'Studio', 'u'), ('ws2', 'Other', 'u')");
const put = (id, kind, data, ws = 'ws') => pg.query("INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ($1, 'u', $2, $3, to_jsonb($4::text), 1)", [id, ws, kind, JSON.stringify(data)]);
await put('post1', 'editorial_post', { id: 'post1', name: 'Story', history: [] });
await put('titles:ws:u', 'meta', { titles: ['designer', 'editor'] });
await pg.query("INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ('ok', 'u', 'ws', 'task', '{\"name\":\"fine\"}'::jsonb, 3)");
const doc = (id, createdAt, name, ws = 'ws', type = 'facture', number = 'FACTURE-2026-0001') =>
  put(id, 'document', { id, kind: 'document', docType: type, number, seq: 1, name, createdAt, history: [{ text: 'Créé', date: createdAt }] }, ws);
await doc('d-late', '2026-09-20T10:00:00Z', 'FACTURE-2026-0001');
await doc('d-first', '2026-09-01T10:00:00Z', 'Facture Atlas');
await doc('d-mid', '2026-09-10T10:00:00Z', 'FACTURE-2026-0001');
await doc('q1', '2026-09-05T10:00:00Z', 'DEVIS-2026-0001', 'ws', 'devis', 'DEVIS-2026-0001');
await doc('other-ws', '2026-09-02T10:00:00Z', 'FACTURE-2026-0001', 'ws2');
const kinds = async () => Object.fromEntries((await pg.query('SELECT id, jsonb_typeof(data) AS t FROM records')).rows.map((r) => [r.id, r.t]));
await check(async () => assert.equal((await kinds()).post1, 'string'));
await assert.rejects(pg.query("UPDATE records SET data = jsonb_set(data, '{publishingAt}', '\"x\"') WHERE id = 'post1'"), /cannot set path in scalar/);

const quiet = console.info; console.info = () => {};
const first = await repairJsonRows(db, '2026-09-26T09:00:00.000Z');
console.info = quiet;
await check(() => assert.deepEqual(first, { records: 2, documents: 5, renumbered: ['FACTURE-2026-0001 → FACTURE-2026-0002', 'FACTURE-2026-0001 → FACTURE-2026-0003'] }));
await check(async () => assert.ok(Object.values(await kinds()).every((t) => t === 'object')));
const data = Object.fromEntries((await pg.query('SELECT id, data, revision FROM records')).rows.map((r) => [r.id, { ...r.data, revision: r.revision }]));
await check(() => assert.equal(data['d-first'].number, 'FACTURE-2026-0001', 'the oldest keeps its number'));
await check(() => assert.equal(data['d-first'].name, 'Facture Atlas'));
await check(() => assert.equal(data['d-first'].history.length, 1, 'and its history is untouched'));
await check(() => assert.equal(data['d-mid'].number, 'FACTURE-2026-0002'));
await check(() => assert.equal(data['d-mid'].seq, 2));
await check(() => assert.equal(data['d-mid'].name, 'FACTURE-2026-0002', 'a name that was the number follows it'));
await check(() => assert.equal(data['d-late'].number, 'FACTURE-2026-0003'));
await check(() => assert.deepEqual(data['d-late'].history.at(-1), { text: 'Numéro corrigé : FACTURE-2026-0001 → FACTURE-2026-0003 (doublon)', date: '2026-09-26T09:00:00.000Z' }));
await check(() => assert.equal(data.q1.number, 'DEVIS-2026-0001', 'another type counts on its own'));
await check(() => assert.equal(data['other-ws'].number, 'FACTURE-2026-0001', 'another workspace counts on its own'));
await check(() => assert.equal(data.ok.name, 'fine'));
await check(() => assert.equal(data.ok.revision, 3, 'a healthy row is not touched'));
await check(() => assert.deepEqual(data['titles:ws:u'].titles, ['designer', 'editor']));

// 3. What failed in production now works, and a second run finds nothing to do.
await db.query("UPDATE records SET data = jsonb_set(data, '{publishingAt}', to_jsonb($1::text)) WHERE id = 'post1'", ['2026-09-26T10:00:00Z']);
await check(async () => assert.equal((await db.query("SELECT data->>'publishingAt' AS at FROM records WHERE id = 'post1'"))[0].at, '2026-09-26T10:00:00Z'));
await check(async () => assert.deepEqual((await db.query("SELECT data->'titles' AS titles FROM records WHERE id = 'titles:ws:u'"))[0].titles, ['designer', 'editor']));
await check(async () => assert.deepEqual(await repairJsonRows(db), { records: 0, documents: 0, renumbered: [] }));

await new Promise((r) => setTimeout(r, 50));
await pg.close();
console.log(`json repair: ${checks} checks passed`);
