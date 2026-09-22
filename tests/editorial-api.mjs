// The publishing queue for n8n: /api/editorial/queue — bearer auth, job selection, result write-back.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';

const esbuildPath = globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0] || 'node_modules/esbuild/lib/main.js';
const esbuild = await import(pathToFileURL(esbuildPath));
mkdirSync('.sites-runtime', { recursive: true });
await esbuild.build({ entryPoints: ['app/api/records/route.ts'], outfile: '.sites-runtime/editorial-records-test.mjs', bundle: true, platform: 'node', format: 'esm', plugins: [testRuntimePlugin({ auth: false })] });
await esbuild.build({ entryPoints: ['app/api/editorial/queue/route.ts'], outfile: '.sites-runtime/editorial-queue-test.mjs', bundle: true, platform: 'node', format: 'esm', plugins: [testRuntimePlugin({ auth: false })] });
await esbuild.build({ entryPoints: ['lib/editorial-queue.ts'], outfile: '.sites-runtime/editorial-queue-lib-test.mjs', bundle: true, platform: 'node', format: 'esm', plugins: [testRuntimePlugin({ auth: false })] });
const { db, pg } = await createTestDb();
globalThis.testDb = db;
const owner = { userId: 'owner-a', fullName: 'Test Owner', displayName: 'Test Owner', email: 'owner@studio.test' };
const SECRET = 'n8n-secret-0123456789abcdef0123456789abcdef';
globalThis.testEnv = { OWNER_EMAIL: 'owner@studio.test', AUTOMATION_SECRET: SECRET };
globalThis.testUser = owner;
const records = await import(pathToFileURL(process.cwd() + '/.sites-runtime/editorial-records-test.mjs'));
const queue = await import(pathToFileURL(process.cwd() + '/.sites-runtime/editorial-queue-test.mjs'));
const { dueJobs } = await import(pathToFileURL(process.cwd() + '/.sites-runtime/editorial-queue-lib-test.mjs'));

let checks = 0;
const WS = 'ws:owner-a';
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
async function app(body, status = 200) {
  const r = await records.POST(new Request('https://tracker.test/api/records', { method: 'POST', headers: { 'Content-Type': 'application/json', origin: 'https://tracker.test', 'X-Workspace-Id': WS }, body: JSON.stringify(body) }));
  const d = await r.json(); assert.equal(r.status, status, JSON.stringify(d)); checks++; return d;
}
async function queueGet(status = 200, token = SECRET) {
  const r = await queue.GET(new Request('https://tracker.test/api/editorial/queue', { headers: token ? { authorization: `Bearer ${token}` } : {} }));
  const d = await r.json(); assert.equal(r.status, status, JSON.stringify(d)); checks++; return d;
}
async function queuePost(body, status = 200, token = SECRET) {
  const r = await queue.POST(new Request('https://tracker.test/api/editorial/queue', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }));
  const d = await r.json(); assert.equal(r.status, status, JSON.stringify(d)); checks++; return d;
}
const casablancaDay = (offset = 0) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); };

// Workspace, client and the three seeded platforms.
await records.GET(new Request('https://tracker.test/api/records'));
const first = await app({ action: 'create', kind: 'client', data: { name: 'Riad Sefrou', quota: '4' } });
const platforms = first.records.filter((r) => r.kind === 'platform');
const ig = platforms.find((p) => p.name === 'Instagram'), fb = platforms.find((p) => p.name === 'Facebook');
ok(ig && fb, 'default platforms seeded');

// Auth: missing, wrong and short tokens are refused; no secret configured → 503.
await queueGet(401, null);
await queueGet(401, 'x'.repeat(SECRET.length));
await queueGet(401, 'short');
delete globalThis.testEnv.AUTOMATION_SECRET; // the stubbed env module holds this same object
await queueGet(503);
globalThis.testEnv.AUTOMATION_SECRET = SECRET;

// The editorial form accepts and stores the media link and time; a bad time is refused.
await app({ action: 'create', kind: 'editorial_post', data: { name: 'Bad time', clientId: first.id, due: casablancaDay(), channels: [ig.id], time: '25:00' } }, 400);
await app({ action: 'create', kind: 'editorial_post', data: { name: 'Bad link', clientId: first.id, due: casablancaDay(), channels: [ig.id], mediaUrl: 'ftp://x' } }, 400);
const dueNow = await app({ action: 'create', kind: 'editorial_post', data: { name: 'Reel été', clientId: first.id, due: casablancaDay(), channels: [ig.id, fb.id], mediaUrl: 'https://drive.google.com/file/d/abc123/view', description: 'Légende ✨', time: '00:00' } });
const noMedia = await app({ action: 'create', kind: 'editorial_post', data: { name: 'Sans média', clientId: first.id, due: casablancaDay(), channels: [ig.id] } });
const tomorrow = await app({ action: 'create', kind: 'editorial_post', data: { name: 'Demain', clientId: first.id, due: casablancaDay(1), channels: [ig.id], mediaUrl: 'https://drive.google.com/file/d/def/view' } });
const tooOld = await app({ action: 'create', kind: 'editorial_post', data: { name: 'Vieux', clientId: first.id, due: casablancaDay(-10), channels: [ig.id], mediaUrl: 'https://drive.google.com/file/d/old/view' } });
const later = await app({ action: 'create', kind: 'editorial_post', data: { name: 'Ce soir', clientId: first.id, due: casablancaDay(), channels: [ig.id], mediaUrl: 'https://drive.google.com/file/d/eve/view', time: '23:59' } });
const stored = dueNow.records.find((r) => r.id === dueNow.id);
eq([stored.mediaUrl, stored.time], ['https://drive.google.com/file/d/abc123/view', '00:00'], 'media link and time stored on the post');

// GET: one job per (post, platform) that is due now — nothing without media, in the future, too old or later today.
const q1 = await queueGet();
eq(q1.jobs.map((j) => [j.postId, j.platform]).sort(), [[dueNow.id, 'Facebook'], [dueNow.id, 'Instagram']].sort(), 'only the due post, once per platform');
const job = q1.jobs.find((j) => j.platform === 'Instagram');
eq([job.workspaceId, job.name, job.caption, job.mediaUrl, job.client, job.due], [WS, 'Reel été', 'Légende ✨', 'https://drive.google.com/file/d/abc123/view', 'Riad Sefrou', casablancaDay()], 'job carries what n8n needs');
ok(!q1.jobs.some((j) => [noMedia.id, tomorrow.id, tooOld.id, later.id].includes(j.postId)), 'excluded posts stay out');

// The pure selector honours `time` in the studio timezone.
const rows = await (await records.GET(new Request('https://tracker.test/api/records', { headers: { 'X-Workspace-Id': WS } }))).json();
const atMidnight = new Date(`${casablancaDay()}T00:30:00+01:00`);
ok(!dueJobs(rows.records, WS, atMidnight).some((j) => j.postId === later.id), 'a 23:59 post is not offered at 00:30');
const atNight = new Date(`${casablancaDay()}T23:59:30+01:00`);
ok(dueJobs(rows.records, WS, atNight).some((j) => j.postId === later.id), 'a 23:59 post is offered at 23:59');

// POST: a failure is recorded, kept out of the queue for the retry window, and the post is not published.
await queuePost({ postId: dueNow.id, workspaceId: WS, platformId: ig.id, ok: false, error: 'Media not ready' });
let after = (await (await records.GET(new Request('https://tracker.test/api/records', { headers: { 'X-Workspace-Id': WS } }))).json()).records.find((r) => r.id === dueNow.id);
eq([after.publishResults[ig.id].ok, after.publishResults[ig.id].error, !!after.publishedAt], [false, 'Media not ready', false], 'failure stored, not published');
ok(after.history.at(-1).text.includes('Échec sur Instagram'), 'failure in history');
const q2 = await queueGet();
eq(q2.jobs.map((j) => j.platform), ['Facebook'], 'failed platform waits for the retry window; the other is still offered');

// Success on both platforms → publishedAt set, post leaves the queue, revision bumped for open calendars.
const r1 = await queuePost({ postId: dueNow.id, workspaceId: WS, platformId: fb.id, ok: true, externalId: '111_222', url: 'https://facebook.com/111_222' });
eq(r1.published, false);
const r2 = await queuePost({ postId: dueNow.id, workspaceId: WS, platformId: ig.id, ok: true, externalId: '17890', url: 'https://www.instagram.com/p/abc/' });
eq(r2.published, true);
after = (await (await records.GET(new Request('https://tracker.test/api/records', { headers: { 'X-Workspace-Id': WS } }))).json()).records.find((r) => r.id === dueNow.id);
ok(after.publishedAt && after.publishResults[ig.id].ok && after.publishResults[fb.id].url === 'https://facebook.com/111_222', 'published with both results');
ok(after.revision >= 4, 'each result bumps the revision');
eq((await queueGet()).jobs.length, 0, 'published post leaves the queue');

// Editing the post in the app keeps the publish state (unknown form keys are dropped, existing fields kept).
await app({ action: 'update', kind: 'editorial_post', id: dueNow.id, revision: after.revision, data: { name: 'Reel été (renommé)', clientId: first.id, due: casablancaDay(), channels: [ig.id, fb.id], mediaUrl: stored.mediaUrl } });
after = (await (await records.GET(new Request('https://tracker.test/api/records', { headers: { 'X-Workspace-Id': WS } }))).json()).records.find((r) => r.id === dueNow.id);
ok(after.publishedAt && after.publishResults[ig.id].ok, 'publish state survives an edit');

// Bad results: unknown post, platform not targeted, invalid body.
await queuePost({ postId: 'nope', workspaceId: WS, platformId: ig.id, ok: true }, 404);
await queuePost({ postId: tomorrow.id, workspaceId: WS, platformId: fb.id, ok: true }, 400);
await queuePost({ postId: tomorrow.id, workspaceId: WS }, 400);
await queuePost({ postId: tomorrow.id, workspaceId: WS, platformId: ig.id, ok: true }, 401, null);

// Print workspaces are never scanned.
await pg.query("INSERT INTO workspaces (id, name, created_by) VALUES ('ws:owner-a:print', 'The One Print', 'owner-a')");
eq((await queueGet()).ok, true, 'a print workspace does not break the queue');

console.log(`editorial-api: ${checks} checks passed`);
