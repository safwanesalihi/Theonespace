// App activity: how beats become sessions (time in, time out, on screen, active), who may send them,
// and that only the owner reads the report.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';

const esbuildPath = globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0] || 'node_modules/esbuild/lib/main.js';
const esbuild = await import(pathToFileURL(esbuildPath));
mkdirSync('.sites-runtime', { recursive: true });
const { db, pg } = await createTestDb();
globalThis.testDb = db;
globalThis.testEnv = {};
const bundle = async (entry, out) => {
  await esbuild.build({ entryPoints: [entry], outfile: `.sites-runtime/${out}`, bundle: true, platform: 'node', format: 'esm', plugins: [testRuntimePlugin({ auth: false })] });
  return import(pathToFileURL(`${process.cwd()}/.sites-runtime/${out}`));
};
const rules = await bundle('lib/activity-rules.ts', 'activity-rules-test.mjs');
const lib = await bundle('lib/activity.ts', 'activity-lib-test.mjs');
const { GET, POST } = await bundle('app/api/activity/route.ts', 'activity-route-test.mjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

// ---- sessions from beats (pure)
const at = (hhmm, s = 0) => new Date(`2026-09-25T${hhmm}:${String(s).padStart(2, '0')}Z`);
let day = rules.applyBeat(null, 'u', '2026-09-25', at('08:00'), true);
eq(day.sessions, [{ start: at('08:00').toISOString(), end: at('08:00').toISOString(), active: 0 }], 'the first beat opens a session: time in');
day = rules.applyBeat(day, 'u', '2026-09-25', at('08:01'), true);
day = rules.applyBeat(day, 'u', '2026-09-25', at('08:02'), false);
ok(day.sessions.length === 1 && day.sessions[0].end === at('08:02').toISOString(), 'beats a minute apart extend the session: time out moves on');
ok(day.sessions[0].active === 60, 'only the minute with input counts as active; on screen counts both');
eq(rules.onScreenSeconds(day), 120, 'two minutes on screen');
day = rules.applyBeat(day, 'u', '2026-09-25', at('08:06'), true);
ok(day.sessions.length === 1 && day.sessions[0].active === 60 + 90, 'a late beat within the gap credits at most 90 s of activity');
day = rules.applyBeat(day, 'u', '2026-09-25', at('09:00'), true);
ok(day.sessions.length === 2 && day.sessions[1].active === 0, 'a silence longer than the gap closes the session; the next beat opens another');
eq(rules.activeSeconds(day), 150, 'active time adds up across sessions');
const back = rules.applyBeat(day, 'u', '2026-09-25', at('08:59'), true);
ok(back.sessions.length === 3, 'a beat from the past never extends a session backwards');

// ---- the API
await pg.query("INSERT INTO workspaces (id, name, created_by) VALUES ('ws:o', 'The One Space', 'o'), ('ws:other', 'Other', 'x')");
await pg.query(`INSERT INTO workspace_members (workspace_id, user_id, role, name, email) VALUES
  ('ws:o', 'o', 'owner', 'Owner', 'owner@t.test'), ('ws:o', 'a', 'admin', 'Admin', 'admin@t.test'),
  ('ws:o', 'y', 'creative', 'Yasmine', 'y@t.test'), ('ws:o', 'c', 'client', 'Client', 'c@t.test')`);
const user = (id) => ({ userId: id, fullName: id, displayName: id, email: `${id}@t.test`, avatar: null, mustChangePassword: false });
const as = (u) => { globalThis.testUser = u; };
const B = 'https://tracker.test';
const beat = (workspace, active = true, origin = B) => POST(new Request(`${B}/api/activity`, { method: 'POST', headers: { 'Content-Type': 'application/json', origin, 'X-Workspace-Id': workspace }, body: JSON.stringify({ active }) }));
const report = (workspace, query) => GET(new Request(`${B}/api/activity?${query}`, { headers: { 'X-Workspace-Id': workspace } }));

as(undefined);
ok((await beat('ws:o')).status === 401, 'signed out: no beat');
as(user('y'));
ok((await beat('ws:o', true, 'https://evil.test')).status === 403, 'a beat from another origin is refused');
ok((await beat('ws:other')).status === 403, 'nobody records time in a workspace they are not part of');
ok((await beat('ws:o')).status === 204, 'a member records their own time');
as(user('c'));
ok((await beat('ws:o')).status === 204, 'a client contact is recorded too');
await lib.recordBeat('ws:o', 'y', true, new Date(Date.now() + 60_000));
const rows = await db.query("SELECT kind, data FROM records WHERE starts_with(id, 'activity:ws:o:y:')");
ok(rows.length === 1 && rows[0].kind === 'meta', "one 'meta' row per person and day, never part of the records the app loads");
ok(rows[0].data.sessions[0].active >= 59, 'the second beat credited the minute in between');

const today = new Date().toISOString().slice(0, 10);
const from = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
const window = `from=${from}&to=${new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}`;
for (const id of ['a', 'y', 'c']) {
  as(user(id));
  ok((await report('ws:o', window)).status === 403, `${id === 'a' ? 'an admin' : id === 'y' ? 'a member' : 'a client'} cannot read the report`);
}
as(user('o'));
const read = await report('ws:o', window);
ok(read.status === 200, 'the owner reads the report');
const data = await read.json();
ok(data.days.some((d) => d.userId === 'y') && data.days.some((d) => d.userId === 'c'), 'every person with activity is in it');
ok(!!data.lastSeen.y && !!data.lastSeen.c, 'with when each was last seen');
ok((await report('ws:o', 'from=2026-01-01&to=2026-12-31')).status === 400, 'a period longer than three months is refused');
ok((await report('ws:o', `from=${today}&to=nope`)).status === 400, 'dates are validated');
ok((await report('ws:other', window)).status === 403, "the owner of one studio can't read another's");

// Old days are cleaned up when the report is read.
await pg.query("INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ('activity:ws:o:y:2020-01-01', 'y', 'ws:o', 'meta', '{\"userId\":\"y\",\"day\":\"2020-01-01\",\"sessions\":[]}', 1)");
await report('ws:o', window);
ok(!(await db.query("SELECT 1 FROM records WHERE id = 'activity:ws:o:y:2020-01-01'")).length, `days older than ${rules.activity.keepDays} days are deleted`);

await pg.close();
console.log(`${checks} activity checks passed: sessions from beats (time in, time out, on screen, active, gaps, caps), who may send beats, owner-only report, retention.`);
