// /api/records request pipeline: the boundary checks answer in their fixed order, and the action chain
// keeps its precedence and fall-through rules (features/records/server/actions/index.ts).
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';

const esbuild = await import(pathToFileURL(globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0]));
mkdirSync('.sites-runtime', { recursive: true });
await esbuild.build({ entryPoints: ['app/api/records/route.ts'], outfile: '.sites-runtime/records-pipeline-test.mjs', bundle: true, platform: 'node', format: 'esm', plugins: [testRuntimePlugin({ auth: false })] });
const { db, pg } = await createTestDb();
globalThis.testDb = db;
globalThis.testEnv = { OWNER_EMAIL: 'owner@example.com' };
const owner = { userId: 'owner-a', fullName: 'Owner', displayName: 'Owner', email: 'owner@example.com' };
globalThis.testUser = owner;
const { GET, POST } = await import(pathToFileURL(process.cwd() + '/.sites-runtime/records-pipeline-test.mjs'));

let assertions = 0;
const request = (body, { origin = 'https://tracker.test', type = 'application/json', workspaceId } = {}) => POST(new Request('https://tracker.test/api/records', {
  method: 'POST',
  headers: { ...(type ? { 'Content-Type': type } : {}), ...(origin ? { origin } : {}), ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {}) },
  body: typeof body === 'string' ? body : JSON.stringify(body),
}));
async function expect(promise, status, error) {
  const res = await promise;
  const data = res.status === 304 ? null : await res.json();
  assert.equal(res.status, status, JSON.stringify(data));
  if (error !== undefined) assert.equal(typeof error === 'string' ? data.error : data.code, typeof error === 'string' ? error : error.code);
  // Every answer, refusals included, is uncached and carries the server clock.
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.ok(Date.parse(res.headers.get('X-Server-Time')));
  assertions += 3;
  return data;
}
const as = (user) => { globalThis.testUser = user; };
const member = (userId, role, workspaceId = 'ws:owner-a', clientId = null) => pg.query(
  'INSERT INTO workspace_members (workspace_id, user_id, role, client_id, name, email, created_at) VALUES ($1, $2, $3, $4, $5, $6, now())',
  [workspaceId, userId, role, clientId, userId, `${userId}@example.com`],
);
const person = (userId) => ({ userId, fullName: userId, displayName: userId, email: `${userId}@example.com` });

// ----- boundary checks, in order: each one answers before the next is consulted -----
as(null);
await expect(request('not even json', { origin: 'https://evil.test', type: 'text/plain' }), 401, 'Connexion requise.');
as({ ...owner, mustChangePassword: true });
await expect(request('not even json', { origin: 'https://evil.test' }), 403, { code: 'password-change-required' });
as(owner);
await expect(request('not even json', { origin: 'https://evil.test', type: 'text/plain' }), 403, 'Origine non autorisée.');
await expect(request('not even json', { origin: null }), 403, 'Origine non autorisée.');
await expect(request('not even json', { type: 'text/plain' }), 415, 'Format invalide.');
await expect(request('x'.repeat(300001)), 413, 'Le contenu est trop long.');
await expect(request('not even json'), 400, 'Requête invalide.');
await expect(request('[1, 2]'), 400, 'Requête invalide.');
await expect(request({ action: 'comment', text: 'x'.repeat(26000) }), 413, 'Le contenu est trop long.');
// Only a brief or a service scope may go past 25 000 characters (here it then fails validation, not size).
const longBrief = await (await request({ action: 'create', kind: 'client', data: { name: 'Long', brief: { overview: 'x'.repeat(26000) } } })).json();
assert.notEqual(longBrief.error, 'Le contenu est trop long.'); assertions++;
await expect(request({ action: 'comment', chatOnly: true, taskId: '' }), 404, 'Tâche introuvable.');
await expect(request({ action: 'nothing-like-this' }), 400, 'Action invalide.');

// ----- the action chain -----
const client = await expect(request({ action: 'create', kind: 'client', data: { name: 'Client A' } }), 200);
await expect(request({ action: 'delete-many', kind: 'client', items: [{ id: client.id, revision: 1 }] }), 400, 'Action invalide.');
await member('viewer-a', 'viewer');
await member('client-a', 'client', 'ws:owner-a', client.id);
// A kind-specific delete answers before the generic one (which would name the owner and admins).
as(person('viewer-a'));
await expect(request({ action: 'delete', kind: 'library', id: 'x', revision: 1 }), 403, 'Votre rôle ne peut pas modifier la bibliothèque.');
await expect(request({ action: 'delete', kind: 'platform', id: 'x', revision: 1 }), 403, 'Votre rôle ne peut pas modifier les plateformes.');
await expect(request({ action: 'delete', kind: 'document', id: 'x', revision: 1 }), 403, 'Seul le propriétaire peut supprimer un document.');
await expect(request({ action: 'delete', kind: 'task', id: 'x', revision: 1 }), 403, 'Seuls le propriétaire et les administrateurs peuvent supprimer.');
// Library interactions are for studio roles: from the client portal they match no action at all.
as(person('client-a'));
await expect(request({ action: 'library-used', id: 'x' }), 400, 'Action invalide.');
await expect(request({ action: 'library-favorite', id: 'x', on: true }), 400, 'Action invalide.');
as(person('viewer-a'));
await expect(request({ action: 'library-used', id: 'x' }), 404, 'Élément introuvable.');
// The generic save keeps its own role rule and its « invalid » answer for other kinds.
await expect(request({ action: 'create', kind: 'project', data: { name: 'P', clientId: client.id } }), 403, 'Votre rôle est en lecture seule.');
as(owner);
await expect(request({ action: 'create', kind: 'meta', data: { name: 'x' } }), 400, 'Action invalide.');

// ----- the retired print workspace: it can't be created, and one left in the database never opens -----
await expect(request({ action: 'create-print-workspace' }), 400, 'Action invalide.');
await pg.query("INSERT INTO workspaces (id, name, created_by, created_at, updated_at) VALUES ('ws:owner-a:print', 'The One Print', 'owner-a', now(), now())");
await pg.query("INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES ('ws:owner-a:print', 'owner-a', 'owner', now())");
await expect(request({ action: 'mark-read', ids: [] }, { workspaceId: 'ws:owner-a:print' }), 403, 'Vous n’avez plus accès à cet espace.');
{
  const listed = await (await GET(new Request('https://tracker.test/api/records'))).json();
  assert.ok(!listed.workspaces.some((w) => w.id.endsWith(':print')), 'a leftover print workspace is never offered'); assertions++;
}
// A workspace the person doesn't belong to.
await expect(request({ action: 'mark-read', ids: [] }, { workspaceId: 'ws:someone-else' }), 403, 'Vous n’avez plus accès à cet espace.');

// ----- GET: conversation ids are bounded, and a lost workspace is a 403 -----
const get = (query = '', workspaceId) => GET(new Request(`https://tracker.test/api/records${query}`, { headers: workspaceId ? { 'X-Workspace-Id': workspaceId } : {} }));
await expect(get('?threadTaskId='), 404, 'Tâche introuvable.');
await expect(get(`?chatTaskId=${'x'.repeat(201)}`), 404, 'Tâche introuvable.');
await expect(get('', 'ws:someone-else'), 403, 'Vous n’avez plus accès à cet espace.');
as(person('stranger'));
await expect(get(), 403, { code: 'no-workspace' });

console.log(`records pipeline: ${assertions} assertions passed`);
