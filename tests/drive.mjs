// Drive is an agency connection, never a pasted token. Exercise actual routes with Postgres and a
// deterministic Google server: OAuth replay, role boundaries, idempotent creation and upload recovery.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';
const esbuild = await import(pathToFileURL(globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0]));
mkdirSync('.sites-runtime', { recursive: true });
const { db, pg } = await createTestDb(); globalThis.testDb = db;
const env = { AUTH_URL: 'https://space.test', AUTH_SECRET: 's'.repeat(48), GOOGLE_DRIVE_CLIENT_ID: 'drive-client', GOOGLE_DRIVE_CLIENT_SECRET: 'drive-secret', GOOGLE_DRIVE_PICKER_KEY: 'restricted-picker-key', GOOGLE_DRIVE_PROJECT_NUMBER: '123456' }; globalThis.testEnv = env;
const bundle = async (entry, name) => { await esbuild.build({ entryPoints: [entry], outfile: `.sites-runtime/drive-test-${name}.mjs`, bundle: true, platform: 'node', format: 'esm', plugins: [testRuntimePlugin({ auth: false })] }); return import(pathToFileURL(`${process.cwd()}/.sites-runtime/drive-test-${name}.mjs`)); };
const routes = {};
for (const name of ['connect', 'callback', 'connection', 'plan', 'files', 'uploads', 'download']) routes[name] = await bundle(`app/api/drive/${name}/route.ts`, name);
const store = await bundle('lib/drive-store.ts', 'store'); const model = await bundle('lib/client-folders.ts', 'model');
const google = await bundle('lib/drive-google.ts', 'google'); const loadRecords = (await bundle('lib/flow-server.ts', 'records')).loadRecords;
const assistantTools = await bundle('lib/assistant-tools.ts', 'assistant');
let checks = 0; const eq = (a, b, why) => { assert.deepEqual(a, b, why); checks++; }; const ok = (a, why) => { assert.ok(a, why); checks++; };
const B = 'https://space.test', W = 'ws:drive-owner', C = 'client-atlas', D = 'client-other';
const owner = { userId: 'drive-owner', email: 'drive-owner@test.example', name: 'Owner' }, admin = { userId: 'drive-admin', email: 'admin@test.example', name: 'Admin' };
globalThis.testUser = owner;
await pg.query("INSERT INTO users(id,email,password_hash) VALUES ('drive-owner','drive-owner@test.example','x'),('drive-admin','admin@test.example','x'),('drive-member','member@test.example','x'),('drive-client','client@test.example','x')");
await pg.query("INSERT INTO workspaces(id,name,created_by) VALUES ($1,'Agency','drive-owner'),('ws:elsewhere','Other','drive-owner')", [W]);
await pg.query("INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,'drive-owner','owner'),($1,'drive-admin','admin'),($1,'drive-member','creative'),($1,'drive-client','client')", [W]);
const brief = JSON.parse(readFileSync('public/brief-marque-modele.json', 'utf8')); brief.overview = 'Maison Atlas vend des produits artisanaux. Story frames, reels et photos.';
const scope = { version: 1, title: 'Atelier', cadence: 'monthly', platforms: ['Instagram'], languages: 'FR / AR', items: [{ format: 'story', quantity: 20, definition: '1 story frame = 1 unité' }], adaptations: '', communityManagement: '', exclusions: 'Publicité payante', clientInputs: 'Photos de produit', paymentTerms: 'PRIVATE-PAYMENT', cancellationTerms: 'PRIVATE-CANCEL', rights: 'PRIVATE-RIGHTS', extras: [{ label: 'supplément', unit: 'frame', unitPrice: 123456 }] };
for (const [id, data] of [[C, { name: 'Maison Atlas', brief, serviceScope: scope }], [D, { name: 'Other Client', brief }], ['client-empty', { name: 'Empty' }]]) await pg.query("INSERT INTO records(id,owner,workspace_id,kind,data) VALUES($1,'system',$2,'client',$3::jsonb)", [id, W, JSON.stringify(data)]);
const tree = { version: 1, title: 'Maison Atlas', summary: 'Sources et livrables adaptés au brief.', nodes: [
  { id: 'root', parentId: null, name: 'Maison Atlas', purpose: 'Contenus du client' },
  { id: 'identity', parentId: 'root', name: '01 Identité', purpose: 'Logos et chartes' },
  { id: 'stories', parentId: 'root', name: '02 Stories', purpose: 'Un frame par unité' },
  { id: 'sources', parentId: 'stories', name: 'Sources', purpose: 'Fichiers modifiables' },
  { id: 'approval', parentId: 'stories', name: 'À valider', purpose: 'Exports pour approbation' },
  { id: 'delivery', parentId: 'stories', name: 'Validés', purpose: 'Livrables validés' },
] };
const j = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const caps = { canAddChildren: true, canEdit: true, canTrash: true, canUntrash: true, canDownload: true };
const fileMap = new Map([['agency', { id: 'agency', name: 'Agence', mimeType: model.folderMime, parents: ['my-drive'], capabilities: caps }], ['my-drive', { id: 'my-drive', name: 'My Drive', mimeType: model.folderMime, capabilities: caps }], ['foreign', { id: 'foreign', name: 'Unrelated', mimeType: model.folderMime, parents: ['my-drive'], capabilities: caps }]]);
const sessions = new Map(), calls = []; let idNumber = 0, accountId = 'google-agency', lostCreate = false, aiResult = tree, aiInput = '', refreshes = 0, retries = 0, revoke = false, noScope = false;
const realFetch = globalThis.fetch;
let exchangedCredentials;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url)); const method = init.method ?? 'GET'; const headers = new Headers(init.headers); const b = typeof init.body === 'string' ? JSON.parse(init.body) : null;
  calls.push({ url: u, method, headers, body: b });
  if (u.hostname === 'oauth2.googleapis.com') { const params = init.body; exchangedCredentials = { clientId: params.get('client_id'), clientSecret: params.get('client_secret') }; if (params.get('grant_type') === 'refresh_token') refreshes++; if (revoke) return j({ error: 'invalid_grant' }, 400); return j({ access_token: 'access-private', refresh_token: 'refresh-private', expires_in: 3600, scope: noScope ? 'unrelated.scope' : 'https://www.googleapis.com/auth/drive.file' }); }
  if (u.hostname === 'generativelanguage.googleapis.com') { aiInput = init.body; return j({ candidates: [{ content: { parts: [{ text: JSON.stringify(aiResult) }] }, finishReason: 'STOP' }] }); }
  if (u.pathname === '/drive/v3/about') return j({ user: { permissionId: accountId, displayName: 'Agence Google', emailAddress: 'agency@gmail.test' } });
  if (u.pathname === '/drive/v3/files/generateIds') return j({ ids: Array.from({ length: Number(u.searchParams.get('count')) }, () => `generated-${++idNumber}`) });
  if (u.pathname.startsWith('/upload/drive/v3/files')) {
    if (method === 'POST' || method === 'PATCH') { const id = randomUUID(); sessions.set(id, { metadata: b, fileId: method === 'PATCH' ? u.pathname.split('/').at(-1) : b.id, size: Number(headers.get('X-Upload-Content-Length')), offset: 0, done: false }); return new Response(null, { headers: { Location: `https://www.googleapis.com/upload/drive/v3/files?upload_id=${id}` } }); }
    const session = sessions.get(u.searchParams.get('upload_id')); if (!session) return j({}, 404);
    if (session.done) return j(fileMap.get(session.fileId));
    const range = headers.get('Content-Range');
    if (!range.startsWith('bytes */')) { const match = range.match(/^bytes (\d+)-(\d+)\/(\d+)$/); if (Number(match[1]) !== session.offset) return j({ error: 'range' }, 400); session.offset = Number(match[2]) + 1; }
    if (session.offset >= session.size) { session.done = true; fileMap.set(session.fileId, { ...fileMap.get(session.fileId), ...session.metadata, id: session.fileId, size: String(session.size), capabilities: caps }); return j(fileMap.get(session.fileId)); }
    return new Response(null, { status: 308, headers: session.offset ? { Range: `bytes=0-${session.offset - 1}` } : {} });
  }
  if (u.pathname === '/drive/v3/files' && method === 'POST') {
    ok(u.searchParams.get('supportsAllDrives') === 'true', 'create works in shared drives');
    if (fileMap.has(b.id)) return j({ error: { errors: [{ reason: 'conflict' }] } }, 409);
    const file = { ...b, capabilities: caps }; fileMap.set(b.id, file);
    if (lostCreate) { lostCreate = false; throw new Error('connection lost after Google created the folder'); }
    return j(file);
  }
  if (u.pathname === '/drive/v3/files' && method === 'GET') {
    if (retries > 0) { retries--; return j({}, 429); }
    const query = u.searchParams.get('q'); const parent = query.match(/^'([^']+)' in parents/)?.[1];
    if (fileMap.get(parent)?.driveId) { eq(u.searchParams.get('corpora'), 'drive', 'shared drive corpora'); eq(u.searchParams.get('driveId'), fileMap.get(parent).driveId, 'shared drive id'); }
    const trashed = query.endsWith('trashed=true'); return j({ files: [...fileMap.values()].filter((f) => f.parents?.includes(parent) && !!f.trashed === trashed) });
  }
  if (u.pathname.startsWith('/drive/v3/files/')) {
    const fileId = u.pathname.split('/')[4]; const file = fileMap.get(fileId); if (!file) return j({}, 404);
    if (u.searchParams.get('alt') === 'media' || u.pathname.endsWith('/export')) return new Response(new Uint8Array([1, 2, 3]));
    if (method === 'PATCH') { if (u.searchParams.get('addParents')) file.parents = [u.searchParams.get('addParents')]; Object.assign(file, b); }
    return j(file);
  }
  throw new Error(`Unexpected network call ${u}`);
};
async function route(name, method = 'GET', body, query = {}, expected = 200, extraHeaders = {}) {
  const req = new Request(`${B}/api/drive/${name}?${new URLSearchParams(query)}`, { method, headers: { 'X-Workspace-Id': W, ...(method === 'GET' ? {} : { Origin: B, 'Content-Type': 'application/json' }), ...extraHeaders }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
  const r = await routes[name][method](req); if (expected !== null) eq(r.status, expected, `${name} ${method}: ${r.status}`); return { r, data: r.headers.get('Content-Type')?.includes('json') ? await r.json() : null };
}
const plan = () => route('plan', 'GET', undefined, { clientId: C });
const action = (body, expected = 200) => route('plan', 'POST', { clientId: C, ...body }, {}, expected);
const fileAction = (body, expected = 200) => route('files', 'POST', { clientId: C, ...body }, {}, expected);
async function login(extra = {}) {
  const start = await route('connect', 'GET', undefined, { workspaceId: W, clientId: C }, 303);
  const location = new URL(start.r.headers.get('Location'));
  eq(location.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.file', 'narrow per-file scope');
  eq(location.searchParams.get('redirect_uri'), `${B}/api/drive/callback`, 'canonical exact redirect');
  eq(location.searchParams.get('code_challenge_method'), 'S256', 'PKCE');
  eq(location.searchParams.get('access_type'), 'offline', 'permanent agency authorization');
  const cookie = start.r.headers.get('Set-Cookie').split(';')[0];
  const q = { state: location.searchParams.get('state'), code: 'the-code', ...extra };
  const finish = await route('callback', 'GET', undefined, q, 303, { cookie });
  return { finish, q, cookie };
}
try {
  // An existing web client can be reused without exporting its secret from Vercel.
  const dedicated = { clientId: env.GOOGLE_DRIVE_CLIENT_ID, clientSecret: env.GOOGLE_DRIVE_CLIENT_SECRET };
  env.GOOGLE_CLIENT_ID = 'existing-web-client'; env.GOOGLE_CLIENT_SECRET = 'existing-web-secret';
  eq(store.driveCredentials(), dedicated, 'dedicated Drive pair takes precedence');
  delete env.GOOGLE_DRIVE_CLIENT_ID; delete env.GOOGLE_DRIVE_CLIENT_SECRET;
  ok(store.driveConfigured(), 'existing web Google pair is sufficient');
  const reuseStart = await route('connect', 'GET', undefined, { workspaceId: W }, 303);
  eq(new URL(reuseStart.r.headers.get('Location')).searchParams.get('client_id'), env.GOOGLE_CLIENT_ID, 'consent uses existing web client');
  await google.exchangeDriveToken(new URLSearchParams({ grant_type: 'authorization_code', code: 'reuse' }));
  eq(exchangedCredentials, { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }, 'token exchange uses the same complete pair');
  env.GOOGLE_DRIVE_CLIENT_ID = 'partially-configured';
  eq(store.driveConfigured(), false, 'partial dedicated pair does not borrow another secret');
  await route('connect', 'GET', undefined, { workspaceId: W }, 503);
  delete env.GOOGLE_DRIVE_CLIENT_ID; delete env.GOOGLE_CLIENT_SECRET;
  env.AUTH_GOOGLE_ID = 'sign-in-client'; env.AUTH_GOOGLE_SECRET = 'sign-in-secret';
  eq(store.driveConfigured(), false, 'partial legacy pair does not mix with sign-in credentials');
  delete env.GOOGLE_CLIENT_ID;
  const signInStart = await route('connect', 'GET', undefined, { workspaceId: W }, 303);
  eq(new URL(signInStart.r.headers.get('Location')).searchParams.get('client_id'), env.AUTH_GOOGLE_ID, 'complete sign-in web pair can be reused');
  delete env.AUTH_GOOGLE_ID; delete env.AUTH_GOOGLE_SECRET;
  env.GOOGLE_DRIVE_CLIENT_ID = dedicated.clientId; env.GOOGLE_DRIVE_CLIENT_SECRET = dedicated.clientSecret;
  // Model rejects ambiguous, deep, cyclic and unbounded architectures before Google sees them.
  ok(model.folderBlueprintSchema.safeParse(tree).success, 'valid plan');
  eq(model.orderedFolders({ ...tree, nodes: [...tree.nodes].reverse() }).map((n) => n.id), ['root', 'stories', 'delivery', 'approval', 'sources', 'identity'], 'parents ordered first');
  for (const bad of [null, { ...tree, version: 2 }, { ...tree, nodes: [...tree.nodes, tree.nodes[1]] }, { ...tree, nodes: tree.nodes.map((n) => n.id === 'stories' ? { ...n, parentId: 'sources' } : n) }, { ...tree, nodes: tree.nodes.map((n) => n.id === 'identity' ? { ...n, parentId: 'missing' } : n) }, { ...tree, nodes: tree.nodes.map((n) => n.id === 'identity' ? { ...n, parentId: null } : n) }, { ...tree, nodes: tree.nodes.map((n) => n.id === 'identity' ? { ...n, name: '../outside' } : n) }, { ...tree, nodes: Array.from({ length: 61 }, (_, i) => ({ id: `n${i}`, name: `n${i}`, parentId: i ? 'n0' : null, purpose: '' })) }]) ok(!model.folderBlueprintSchema.safeParse(bad).success, 'invalid trees are rejected');
  await route('connection', 'POST', { action: 'root', id: 'agency' }, {}, 409);
  globalThis.testUser = null;
  await route('plan', 'GET', undefined, { clientId: C }, 401);
  for (const role of ['creative', 'social', 'viewer', 'client']) { await pg.query('UPDATE workspace_members SET role=$2 WHERE workspace_id=$1 AND user_id=\'drive-member\'', [W, role]); globalThis.testUser = { userId: 'drive-member' }; await route('plan', 'GET', undefined, { clientId: C }, 403); await action({ action: 'save', revision: 0, blueprint: tree }, 403); ok(!assistantTools.toolsFor(role, false).some((x) => x.name === 'generate_client_folders'), `${role} has no folder assistant tool`); }
  globalThis.testUser = admin; await route('connect', 'GET', undefined, { workspaceId: W }, 403); await route('connection', 'POST', { action: 'picker' }, {}, 403);
  globalThis.testUser = owner;
  await route('plan', 'GET', undefined, { clientId: C }, 403, { 'X-Workspace-Id': 'ws:elsewhere' });
  await route('plan', 'GET', undefined, { clientId: 'outside' }, 404);
  await route('plan', 'POST', { action: 'save', clientId: C, revision: 0, blueprint: tree }, {}, 403, { Origin: 'https://hostile.test' });
  await route('plan', 'POST', '{bad', {}, 400);
  const first = await login(); ok(first.finish.r.headers.get('Location').includes('driveConnected=1'), 'OAuth succeeds');
  eq(first.finish.r.headers.get('Location').split('#')[1], `client/${C}/files`, 'return to initiating client');
  ok(first.finish.r.headers.get('Set-Cookie').includes('Max-Age=0'), 'clear OAuth cookie');
  const replay = await route('callback', 'GET', undefined, first.q, 303, { cookie: first.cookie }); ok(replay.r.headers.get('Location').includes('driveError='), 'OAuth state can only be consumed once');
  const tampered = await route('callback', 'GET', undefined, { ...first.q, state: `${first.q.state}tamper` }, 303, { cookie: first.cookie }); ok(tampered.r.headers.get('Location').includes('driveError='), 'tampered state refused');
  const privateRow = await store.connection(W); ok(!privateRow.tokens.includes('access-private') && !privateRow.tokens.includes('refresh-private'), 'tokens stored encrypted');
  const publicConnection = (await route('connection')).data; ok(!JSON.stringify(publicConnection).includes('private'), 'connection view has no tokens');
  eq((await loadRecords(W)).some((r) => r.kind === 'meta'), false, 'metadata excluded from client records');
  await route('connection', 'POST', { action: 'root', id: 'foreign-file' }, {}, 404);
  await route('connection', 'POST', { action: 'root', id: 'agency' });
  const picker = (await route('connection', 'POST', { action: 'picker' })).data; eq(picker.accessToken, 'access-private', 'only owner receives short-lived Picker token'); ok(!JSON.stringify(picker).includes('refresh-private'), 'Picker never receives refresh token');
  const tokenRow = await store.readMeta(W, store.connectionKey(W)); await store.writeMeta(W, store.connectionKey(W), { ...tokenRow.data, tokens: store.sealedTokens({ ...store.tokenContents(tokenRow.data, W), expiresAt: 0 }, W) }, tokenRow.revision);
  await google.driveToken(W); eq(refreshes, 1, 'expired token refreshed');
  // AI uses saved brief and production scope, never prices/payment/legal/contact fields.
  await action({ action: 'generate', revision: 0 }, 503);
  env.GEMINI_API_KEY = 'ai-key';
  await route('plan', 'POST', { action: 'generate', clientId: 'client-empty', revision: 0 }, {}, 400);
  aiResult = { ...tree, nodes: [{ id: 'bad', parentId: 'bad', name: 'bad', purpose: '' }] }; await action({ action: 'generate', revision: 0 }, 502);
  aiResult = tree; let p = (await action({ action: 'generate', revision: 0, language: 'ar' })).data.plan;
  ok(aiInput.includes('Maison Atlas') && aiInput.includes('Story frames') && aiInput.includes('Arabic'), 'AI reads current client brief and requested language');
  for (const secret of ['PRIVATE-PAYMENT', 'PRIVATE-CANCEL', 'PRIVATE-RIGHTS', '123456']) ok(!aiInput.includes(secret), 'AI receives no commercial secrets');
  ok(aiInput.includes('20') && aiInput.includes('1 story frame'), 'scope quantities preserved');
  await action({ action: 'save', revision: 0, blueprint: tree }, 409);
  // Losing a create response does not create duplicates on Resume.
  lostCreate = true; await action({ action: 'create', revision: p.revision }, 503);
  p = (await plan()).data.plan; const rootId = p.fileIds.root;
  ok(fileMap.has(rootId) && !p.done.includes('root'), 'interrupted folder is persisted on Google but not falsely marked complete');
  eq(p.lease, undefined, 'lease not leaked to browser');
  p = (await action({ action: 'create', revision: p.revision })).data.plan; eq(p.done.length, 4, 'bounded provisioning batch');
  p = (await action({ action: 'create', revision: p.revision })).data.plan; eq(p.done.length, 6, 'next batch completes');
  eq([...fileMap.values()].filter((f) => f.appProperties?.trackerClient === C).length, 6, 'exactly one folder per plan node');
  await action({ action: 'save', revision: p.revision, blueprint: tree }, 409); await action({ action: 'generate', revision: p.revision }, 409);
  await route('files', 'GET', undefined, { clientId: C, folderId: 'foreign' }, 403);
  await fileAction({ action: 'move', fileId: p.fileIds.stories, parentId: p.fileIds.sources }, 400);
  await fileAction({ action: 'trash', fileId: rootId }, 409);
  await fileAction({ action: 'move', fileId: p.fileIds.identity, parentId: 'foreign' }, 403);
  const operationId = randomUUID(); const created = (await fileAction({ action: 'folder', parentId: rootId, name: 'Photos', requestId: operationId })).data.file;
  eq((await fileAction({ action: 'folder', parentId: rootId, name: 'Photos', requestId: operationId })).data.file.id, created.id, 'manual folder idempotent');
  await fileAction({ action: 'folder', parentId: rootId, name: 'Changed', requestId: operationId }, 409);
  await fileAction({ action: 'rename', fileId: created.id, name: 'Photos produit' }); eq(fileMap.get(created.id).name, 'Photos produit', 'rename visible in Google');
  await fileAction({ action: 'move', fileId: created.id, parentId: p.fileIds.identity }); eq(fileMap.get(created.id).parents, [p.fileIds.identity], 'move within client');
  await fileAction({ action: 'trash', fileId: created.id }); eq((await route('files', 'GET', undefined, { clientId: C, folderId: p.fileIds.identity, trash: '1' })).data.files[0].id, created.id, 'folder trash visible');
  await fileAction({ action: 'restore', fileId: created.id }); eq(fileMap.get(created.id).trashed, false, 'trash reversible');
  retries = 1; await route('files', 'GET', undefined, { clientId: C }); eq(retries, 0, 'quota read retried');
  fileMap.get(rootId).driveId = 'shared-1'; await route('files', 'GET', undefined, { clientId: C });
  globalThis.testUser = admin; await route('files', 'GET', undefined, { clientId: C }); await fileAction({ action: 'folder', parentId: rootId, name: 'Production admin', requestId: randomUUID() });
  globalThis.testUser = owner;
  // Uploads use protected resumable sessions and blocks smaller than the Vercel request limit.
  const uploadId = randomUUID(), uploadSize = 4 * 1024 * 1024 + 500;
  const input = { clientId: C, parentId: rootId, name: 'shooting.mp4', mimeType: 'video/mp4', size: uploadSize, requestId: uploadId };
  const opened = (await route('uploads', 'POST', input)).data; eq(opened.chunkSize, 4 * 1024 * 1024, '4 MiB blocks fit Vercel'); ok(!JSON.stringify(opened).includes('upload_id='), 'session URI never exposed');
  eq((await route('uploads', 'GET', undefined, { uploadId })).data.offset, 0, 'new session starts empty');
  async function chunk(id, offset, bytes, expected = 200) { const r = await routes.uploads.PUT(new Request(`${B}/api/drive/uploads?${new URLSearchParams({ uploadId: id, offset: String(offset) })}`, { method: 'PUT', headers: { 'X-Workspace-Id': W, Origin: B, 'Content-Type': 'application/octet-stream' }, body: bytes })); const d = await r.json(); eq(r.status, expected, JSON.stringify(d)); return d; }
  await chunk(uploadId, 0, new Uint8Array(opened.chunkSize));
  eq((await route('uploads', 'GET', undefined, { uploadId })).data.offset, opened.chunkSize, 'resume reads acknowledged offset');
  globalThis.testUser = admin; await route('uploads', 'GET', undefined, { uploadId }, 404); globalThis.testUser = owner;
  const uploaded = await chunk(uploadId, opened.chunkSize, new Uint8Array(500)); ok(uploaded.done, 'final block completes');
  eq((await route('uploads', 'GET', undefined, { uploadId })).data.done, true, 'completed session idempotent');
  eq((await chunk(uploadId, opened.chunkSize, new Uint8Array(500))).file.id, uploaded.file.id, 'repeat final block does not duplicate');
  await route('uploads', 'POST', { ...input, size: input.size + 1 }, {}, 409);
  await route('uploads', 'POST', { ...input, requestId: randomUUID(), size: 1024 ** 3 + 1 }, {}, 400);
  await chunk(randomUUID(), 0, new Uint8Array(1), 404);
  const replaceId = randomUUID(); await route('uploads', 'POST', { ...input, size: 512, requestId: replaceId, replaceId: uploaded.file.id });
  const replaced = await chunk(replaceId, 0, new Uint8Array(512)); eq(replaced.file.id, uploaded.file.id, 'new version preserves Drive file id');
  const download = await route('download', 'GET', undefined, { workspaceId: W, clientId: C, fileId: uploaded.file.id }); eq(download.r.headers.get('Content-Type'), 'application/octet-stream', 'download forces attachment'); ok(download.r.headers.get('Content-Disposition').includes('attachment'), 'no inline executable content');
  await route('download', 'GET', undefined, { workspaceId: W, clientId: C, fileId: 'foreign' }, 403);
  // A change made in Drive is visible on refresh; moving outside the client removes app access.
  fileMap.get(uploaded.file.id).name = 'Renommé dans Drive.mp4'; eq((await route('files', 'GET', undefined, { clientId: C })).data.files.find((f) => f.id === uploaded.file.id).name, 'Renommé dans Drive.mp4', 'live Drive rename visible');
  fileMap.get(uploaded.file.id).parents = ['foreign']; await fileAction({ action: 'rename', fileId: uploaded.file.id, name: 'outside' }, 403);
  fileMap.set('selected', { id: 'selected', name: 'Photo existante', mimeType: 'image/jpeg', parents: ['foreign'], capabilities: caps });
  globalThis.testUser = admin; await fileAction({ action: 'import', fileId: 'selected', parentId: rootId }, 403); globalThis.testUser = owner;
  await fileAction({ action: 'import', fileId: 'selected', parentId: rootId }); eq(fileMap.get('selected').parents, [rootId], 'owner-confirmed selected file moved');
  await fileAction({ action: 'import', fileId: 'selected', parentId: rootId }); eq(fileMap.get('selected').parents, [rootId], 'retry import safe');
  fileMap.set('other-client-file', { id: 'other-client-file', name: 'Private', mimeType: 'image/jpeg', parents: ['foreign'], capabilities: caps, appProperties: { trackerWorkspace: W, trackerClient: D } }); await fileAction({ action: 'import', fileId: 'other-client-file', parentId: rootId }, 403);
  // Another account cannot silently rebind existing clients; reconnecting same account restores them.
  accountId = 'new-account'; await login(); await route('files', 'GET', undefined, { clientId: C }, 409); eq((await route('connection')).data.root, undefined, 'new account needs new agency root');
  accountId = 'google-agency'; await login(); await route('connection', 'POST', { action: 'root', id: 'agency' }); await route('files', 'GET', undefined, { clientId: C });
  noScope = true; ok((await login()).finish.r.headers.get('Location').includes('driveError='), 'denied scope rejected'); noScope = false;
  const last = await store.readMeta(W, store.connectionKey(W)); await store.writeMeta(W, store.connectionKey(W), { ...last.data, tokens: store.sealedTokens({ ...store.tokenContents(last.data, W), expiresAt: 0 }, W) }, last.revision); revoke = true; await route('files', 'GET', undefined, { clientId: C }, 401); revoke = false;
  const beforeDisconnect = fileMap.size; await route('connection', 'POST', { action: 'disconnect' }); eq(fileMap.size, beforeDisconnect, 'disconnect preserves all Drive files'); await route('files', 'GET', undefined, { clientId: C }, 409);
  ok(assistantTools.toolsFor('owner', false).some((x) => x.name === 'generate_client_folders'), 'owner assistant can propose folders'); ok(!assistantTools.toolsFor('owner', true).some((x) => x.name === 'generate_client_folders'), 'print assistant has its own scope');
  const savedCalls = []; const tool = assistantTools.toolRunner({ role: 'admin', userId: admin.userId, userName: 'Admin', workspaceId: W, visible: [{ kind: 'client', id: C, name: 'Maison Atlas' }], team: [], save: async () => { throw new Error('Not a records operation'); }, generateFolders: async (id) => { savedCalls.push(id); return { previewUrl: `/#client/${id}/files`, createdInDrive: false }; }, onAction: () => {} });
  eq((await tool('generate_client_folders', { client: 'Atlas' })).createdInDrive, false, 'assistant only saves a reviewable draft'); eq(savedCalls, [C], 'tool resolves current workspace client');
  console.log(`Google Drive checks passed: ${checks} (OAuth, roles, client isolation, encrypted tokens, brief AI, resumable provisioning/uploads, live files, trash and reconnect).`);
} finally { globalThis.fetch = realFetch; await pg.close(); }
