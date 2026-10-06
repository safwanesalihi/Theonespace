// Client images: upload by studio roles only, served to workspace members only, replaced images dropped.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';

const esbuildPath = globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0] || 'node_modules/esbuild/lib/main.js';
const esbuild = await import(pathToFileURL(esbuildPath));
mkdirSync('.sites-runtime/assets-tests', { recursive: true });
await esbuild.build({
  entryPoints: { upload: 'app/api/assets/route.ts', serve: 'app/api/assets/[id]/route.ts', records: 'app/api/records/route.ts', init: 'app/api/assets/uploads/route.ts', chunks: 'app/api/assets/uploads/[id]/route.ts', files: 'lib/task-files.ts' },
  outdir: '.sites-runtime/assets-tests', outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node', format: 'esm', external: ['nodemailer'],
  plugins: [testRuntimePlugin({ auth: false })],
});
const { db, pg } = await createTestDb();
globalThis.testDb = db;
globalThis.testEnv = { OWNER_EMAIL: 'owner@studio.test' };
const owner = { userId: 'owner', fullName: 'Owner', displayName: 'Owner', email: 'owner@studio.test' };
const outsider = { userId: 'outsider', fullName: 'Out', displayName: 'Out', email: 'out@else.test' };
globalThis.testUser = owner;
const upload = await import(pathToFileURL(process.cwd() + '/.sites-runtime/assets-tests/upload.mjs'));
const serve = await import(pathToFileURL(process.cwd() + '/.sites-runtime/assets-tests/serve.mjs'));
const records = await import(pathToFileURL(process.cwd() + '/.sites-runtime/assets-tests/records.mjs'));
const init = await import(pathToFileURL(process.cwd() + '/.sites-runtime/assets-tests/init.mjs'));
const chunks = await import(pathToFileURL(process.cwd() + '/.sites-runtime/assets-tests/chunks.mjs'));
const files = await import(pathToFileURL(process.cwd() + '/.sites-runtime/assets-tests/files.mjs'));

let checks = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const origin = 'https://tracker.test';
// Upload tests must stay outside the seven-day scheduling lock as calendar time advances.
const futureDay = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
const WS = 'ws:owner';
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
async function send(kind, file, headers = {}) {
  const body = new FormData(); body.append('kind', kind); if (file) body.append('file', file);
  const r = await upload.POST(new Request(origin + '/api/assets', { method: 'POST', headers: { origin, 'X-Workspace-Id': WS, ...headers }, body }));
  return { status: r.status, data: await r.json() };
}
const get = (id, headers = {}) => serve.GET(new Request(origin + '/api/assets/' + id, { headers }), { params: Promise.resolve({ id }) });
const startUpload = data => init.POST(new Request(origin + '/api/assets/uploads', { method: 'POST', headers: { origin, 'X-Workspace-Id': WS, 'Content-Type': 'application/json' }, body: JSON.stringify(data) }));
const chunkRequest = (id, method, body, part = '', headers = {}) => chunks[method](new Request(origin + '/api/assets/uploads/' + id + (part === '' ? '' : '?part=' + part), { method, headers: { origin, 'X-Workspace-Id': WS, ...headers }, ...(body ? { body } : {}) }), { params: Promise.resolve({ id }) });
const mutate = (body) => records.POST(new Request(origin + '/api/records', { method: 'POST', headers: { origin, 'content-type': 'application/json', 'X-Workspace-Id': WS }, body: JSON.stringify(body) }));

await records.GET(new Request(origin + '/api/records'));
const client = await (await mutate({ action: 'create', kind: 'client', data: { name: 'Logo Client' } })).json();

// Upload rules.
eq((await send('logo', new File([png], 'logo.png', { type: 'image/png' }))).status, 200);
eq((await send('poster', new File([png], 'x.png', { type: 'image/png' }))).status, 400, 'unknown kind');
eq((await send('logo', new File([png], 'x.svg', { type: 'image/svg+xml' }))).status, 415, 'svg refused');
eq((await send('logo', new File([new Uint8Array(1_600_000)], 'big.png', { type: 'image/png' }))).status, 413, 'too large');
eq((await send('logo', null)).status, 400, 'no file');
const first = (await send('logo', new File([png], 'logo.png', { type: 'image/png' }))).data.id;
const banner = (await send('banner', new File([png], 'banner.png', { type: 'image/png' }))).data.id;

// Serving: members of the workspace only; immutable caching.
const ok = await get(first);
eq([ok.status, ok.headers.get('content-type'), ok.headers.get('cache-control')], [200, 'image/png', 'private, max-age=31536000, immutable']);
eq(new Uint8Array(await ok.arrayBuffer()), png);
globalThis.testUser = outsider;
eq((await get(first)).status, 404, 'outsiders never see the image');
eq((await send('logo', new File([png], 'x.png', { type: 'image/png' }))).status, 403, 'outsiders cannot upload');
globalThis.testUser = null;
eq((await get(first)).status, 401);
globalThis.testUser = owner;
eq((await get('not-a-uuid')).status, 404);

// Attach to the client, then replace: the previous image is deleted, the new one kept.
const attached = await (await mutate({ action: 'update', kind: 'client', id: client.id, revision: 1, data: { name: 'Logo Client', logo: first, banner } })).json();
eq([attached.records.find((r) => r.id === client.id).logo, attached.records.find((r) => r.id === client.id).banner], [first, banner]);
eq((await mutate({ action: 'update', kind: 'client', id: client.id, revision: 2, data: { name: 'Logo Client', logo: 'nope', banner } })).status, 400, 'asset ids are validated');
eq((await mutate({ action: 'update', kind: 'client', id: client.id, revision: 2, data: { name: 'Logo Client', logo: crypto.randomUUID(), banner } })).status, 400, 'a well-formed id from outside this workspace is refused');
eq((await mutate({ action: 'update', kind: 'client', id: client.id, revision: 2, data: { name: 'Logo Client', logo: banner, banner } })).status, 400, 'a banner cannot be passed off as a logo');
const second = (await send('logo', new File([png], 'logo2.png', { type: 'image/png' }))).data.id;
await mutate({ action: 'update', kind: 'client', id: client.id, revision: 2, data: { name: 'Logo Client', logo: second, banner } });
eq((await get(first)).status, 404, 'replaced logo dropped');
eq((await get(second)).status, 200);
eq((await get(banner)).status, 200, 'untouched banner kept');
await mutate({ action: 'update', kind: 'client', id: client.id, revision: 3, data: { name: 'Logo Client', logo: second, banner: '' } });
eq((await get(banner)).status, 404, 'removed banner dropped');
eq((await pg.query('SELECT count(*)::int AS n FROM assets')).rows[0].n, 2, 'only the live logo and the first unattached upload remain');

// Logo and banner belong to clients only: a project can't carry an image id, so clearing it can't delete someone else's asset.
{
  const projectView = await (await mutate({ action: 'create', kind: 'project', data: { name: 'Projet sans logo', clientId: client.id } })).json();
  const revisionOf = (view, id) => view.records.find((r) => r.id === id).revision;
  const strayLogo = (await send('logo', new File([png], 'stray.png', { type: 'image/png' }))).data.id;
  const withLogo = await mutate({ action: 'update', kind: 'project', id: projectView.id, revision: revisionOf(projectView, projectView.id), data: { name: 'Projet sans logo', clientId: client.id, logo: strayLogo, banner: strayLogo } });
  eq(withLogo.status, 200, 'a project update carrying a logo id is accepted but the image is ignored');
  const stored = (await pg.query("SELECT data->>'logo' AS logo, data->>'banner' AS banner FROM records WHERE id = $1", [projectView.id])).rows[0];
  eq([stored.logo, stored.banner], [null, null], 'a project never stores a logo or a banner');
  const withoutLogo = await mutate({ action: 'update', kind: 'project', id: projectView.id, revision: revisionOf(await withLogo.json(), projectView.id), data: { name: 'Projet sans logo', clientId: client.id, logo: '' } });
  eq(withoutLogo.status, 200, 'clearing the logo of a project is accepted');
  eq((await pg.query('SELECT id FROM assets WHERE id = $1', [strayLogo])).rows.length, 1, 'and no asset row is deleted by it');
  eq((await get(strayLogo)).status, 200, 'the image is still served');
}

// Members (creative) cannot touch a client's logo/banner either — that page is studio-owned — but they keep their own picture.
const member = { userId: 'member', fullName: 'Yasmine', displayName: 'Yasmine', email: 'yasmine@studio.test' };
await pg.query("INSERT INTO users (id, name, email, password_hash) VALUES ('member', 'Yasmine', 'yasmine@studio.test', 'x')");
await pg.query("INSERT INTO workspace_members (workspace_id, user_id, role, name, email) VALUES ($1, 'member', 'creative', 'Yasmine', 'yasmine@studio.test')", [WS]);
globalThis.testUser = member;
eq((await send('logo', new File([png], 'x.png', { type: 'image/png' }))).status, 403, 'members cannot upload client images either');
const memberAvatar = (await send('avatar', new File([png], 'me.png', { type: 'image/png' }))).data.id;
eq(typeof memberAvatar, 'string', 'members can still upload their own picture');
globalThis.testUser = owner;

// Profile pictures: any member (a client included) sets their own; replaced pictures are dropped; visible to any signed-in user.
const contact = { userId: 'contact', fullName: 'Amina', displayName: 'Amina', email: 'amina@client.test' };
await pg.query("INSERT INTO users (id, name, email, password_hash) VALUES ('contact', 'Amina', 'amina@client.test', 'x')");
await pg.query("INSERT INTO workspace_members (workspace_id, user_id, role, name, email, client_id) VALUES ($1, 'contact', 'client', 'Amina', 'amina@client.test', $2)", [WS, client.id]);
globalThis.testUser = contact;
eq((await send('logo', new File([png], 'x.png', { type: 'image/png' }))).status, 403, 'clients cannot upload client images');
const avatar1 = (await send('avatar', new File([png], 'me.png', { type: 'image/png' }))).data.id;
eq(typeof avatar1, 'string', 'clients can upload their own picture');
eq((await mutate({ action: 'update-profile', avatar: 'nope' })).status, 400, 'picture id validated');
const withAvatar = await (await mutate({ action: 'update-profile', avatar: avatar1 })).json();
eq(withAvatar.user.avatar, avatar1);
const avatar2 = (await send('avatar', new File([png], 'me2.png', { type: 'image/png' }))).data.id;
await mutate({ action: 'update-profile', avatar: avatar2, name: 'Amina Benali' });
eq((await get(avatar1)).status, 404, 'replaced picture dropped');
globalThis.testUser = outsider;
eq((await get(avatar2)).status, 200, 'pictures are visible to any signed-in user');
globalThis.testUser = owner;
const roster = await (await records.GET(new Request(origin + '/api/records', { headers: { 'X-Workspace-Id': WS } }))).json();
eq([roster.members.find((m) => m.userId === 'contact').avatar, roster.members.find((m) => m.userId === 'contact').name], [avatar2, 'Amina Benali'], 'roster carries the picture and the new name');
globalThis.testUser = contact;
await mutate({ action: 'update-profile', avatar: null });
eq((await get(avatar2)).status, 404, 'removed picture dropped');
globalThis.testUser = owner;

// Voice messages: a client records one on a comment or a change request; the studio hears it back.
globalThis.testUser = owner;
const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6, 7, 8]);
const project = await (await mutate({ action: 'create', kind: 'project', data: { name: 'Voice project', clientId: client.id } })).json();
const task = await (await mutate({ action: 'create', kind: 'task', data: { name: 'Voice task', clientId: client.id, projectId: project.id, status: 'En cours', due: futureDay, source: 'Interne', assignee: '' } })).json();
await mutate({ action: 'update', kind: 'task', id: task.id, revision: 1, data: { name: 'Voice task', clientId: client.id, projectId: project.id, status: 'À valider', due: futureDay, source: 'Interne', assignee: '', deliverable: 'https://example.com/v1.pdf' } });
globalThis.testUser = contact;
eq((await send('audio', new File([webm], 'voice.webm', { type: 'audio/webm;codecs=opus' }))).status, 200, 'clients can upload a voice message (codec parameter tolerated)');
eq((await send('audio', new File([png], 'x.png', { type: 'image/png' }))).status, 415, 'images are not voice messages');
eq((await send('audio', new File([new Uint8Array(8_000_001)], 'long.webm', { type: 'audio/webm' }))).status, 413, 'voice messages are capped at 8 MB');
const voice = (await send('audio', new File([webm], 'voice.webm', { type: 'audio/webm;codecs=opus' }))).data.id;
const served = await get(voice);
eq([served.status, served.headers.get('content-type')], [200, 'audio/webm'], 'stored with the bare media type');
eq((await mutate({ action: 'comment', taskId: task.id, text: '', audio: 'nope' })).status, 400, 'voice ids are validated');
eq((await mutate({ action: 'comment', taskId: task.id, text: '' })).status, 400, 'a comment needs text or a voice message');
const voiceOnly = await (await mutate({ action: 'comment', taskId: task.id, text: '', audio: voice })).json();
eq(voiceOnly.records.find((r) => r.kind === 'comment' && r.audio === voice)?.name, '', 'a voice-only comment keeps an empty text');
const voice2 = (await send('audio', new File([webm], 'voice2.webm', { type: 'audio/mp4' }))).data.id;
globalThis.testUser = owner;
eq((await mutate({ action: 'comment', taskId: task.id, text: 'mine?', audio: voice2 })).status, 400, 'only the uploader can attach their own voice message');
globalThis.testUser = contact;
const changes = await (await mutate({ action: 'request-changes', taskId: task.id, text: '', audio: voice2 })).json();
const round = changes.records.find((r) => r.kind === 'comment' && r.audio === voice2);
eq([round?.name, changes.records.find((r) => r.id === task.id).status], ['[Retours client — tour 1]', 'En cours'], 'a voice-only change request counts as a round');
globalThis.testUser = member;
eq((await get(voice)).status, 200, 'studio members can play the voice message');
globalThis.testUser = outsider;
eq((await get(voice)).status, 404, 'outsiders cannot');
globalThis.testUser = owner;
await mutate({ action: 'delete', kind: 'task', id: task.id, revision: 3 });
eq([(await get(voice)).status, (await get(voice2)).status], [404, 404], 'deleting the task drops its voice messages');

// A task's conversation: files (PDFs, photos) in messages, private to the task's client and the studio.
{
  const pdf = new Uint8Array([...new TextEncoder().encode('%PDF-1.7\n'), 1, 2, 3, 4]);
  const chatTask = await (await mutate({ action: 'create', kind: 'task', data: { name: 'Chat task', clientId: client.id, projectId: project.id, status: 'En cours', due: futureDay, source: 'Interne', assignee: '' } })).json();
  const other = await (await mutate({ action: 'create', kind: 'client', data: { name: 'Autre client' } })).json();
  const otherTask = await (await mutate({ action: 'create', kind: 'task', data: { name: 'Other chat', clientId: other.id, status: 'En cours', due: futureDay, source: 'Interne', assignee: '' } })).json();
  const brief = (await send('file', new File([pdf], 'Brief final.pdf', { type: 'application/pdf' })));
  eq(brief.status, 200, 'the studio sends a PDF');
  eq((await send('file', new File([png], 'fake.pdf', { type: 'application/pdf' }))).status, 415, 'a file that only claims to be a PDF is refused');
  eq((await send('file', new File([pdf], 'source.ai', { type: 'application/postscript' }))).status, 200, 'design source files are accepted too');
  eq((await send('file', new File([new Uint8Array(4_000_001)], 'big.pdf', { type: 'application/pdf' }))).status, 413, 'files are capped at 4 MB');
  const photo = (await send('file', new File([png], 'photo.png', { type: 'image/png' }))).data.id;
  const sent = await (await mutate({ action: 'comment', taskId: chatTask.id, text: '', attachments: [{ id: brief.data.id, name: 'Brief final.pdf' }, { id: photo, name: '../photo.png' }] })).json();
  const message = sent.records.find((r) => r.kind === 'comment' && r.taskId === chatTask.id);
  eq(message.attachments.map((a) => [a.name, a.type]), [['Brief final.pdf', 'application/pdf'], ['.. photo.png', 'image/png']], 'a message can be only files, with their names (paths stripped)');
  const opened = await get(brief.data.id);
  eq([opened.status, opened.headers.get('content-type'), opened.headers.get('content-disposition')], [200, 'application/pdf', "inline; filename*=UTF-8''fichier"], 'a PDF opens in the browser');
  const saved = await serve.GET(new Request(origin + '/api/assets/' + brief.data.id + '?download=Brief%20final.pdf'), { params: Promise.resolve({ id: brief.data.id }) });
  eq(saved.headers.get('content-disposition'), "attachment; filename*=UTF-8''Brief%20final.pdf", '« Télécharger » saves it under its name');
  eq((await mutate({ action: 'comment', taskId: chatTask.id, text: 'x', attachments: [{ id: 'not-an-id' }] })).status, 400, 'file ids are validated');
  eq((await mutate({ action: 'comment', taskId: chatTask.id, text: 'x', attachments: Array.from({ length: 11 }, () => ({ id: photo })) })).status, 400, 'at most 10 files a message');
  const secret = (await send('file', new File([pdf], 'Devis autre client.pdf', { type: 'application/pdf' }))).data.id;
  await mutate({ action: 'comment', taskId: otherTask.id, text: 'Pour l’autre client', attachments: [{ id: secret, name: 'Devis autre client.pdf' }] });

  globalThis.testUser = contact;
  eq((await get(brief.data.id)).status, 200, 'the client opens the files sent on their task');
  eq((await get(secret)).status, 404, 'never a file from another client’s task');
  const clientPdf = (await send('file', new File([pdf], 'Logo client.pdf', { type: 'application/pdf' }))).data.id;
  eq((await get(clientPdf)).status, 200, 'the client sees what they just uploaded');
  eq((await mutate({ action: 'comment', taskId: chatTask.id, text: 'Voici le logo', attachments: [{ id: photo }] })).status, 400, 'nobody sends someone else’s upload');
  const reply = await (await mutate({ action: 'comment', taskId: chatTask.id, text: 'Voici le logo', attachments: [{ id: clientPdf, name: 'Logo client.pdf' }] })).json();
  eq(reply.records.some((r) => r.kind === 'comment' && r.attachments?.[0]?.id === clientPdf), true, 'the client answers with a PDF');
  eq((await mutate({ action: 'comment', taskId: otherTask.id, text: 'x' })).status, 404, 'and cannot write on another client’s task');
  globalThis.testUser = member;
  eq((await get(clientPdf)).status, 200, 'the studio opens the client’s file');
  globalThis.testUser = outsider;
  eq((await get(clientPdf)).status, 404, 'outsiders cannot');
  globalThis.testUser = owner;
  const events = (await (await records.GET(new Request(origin + '/api/records', { headers: { 'X-Workspace-Id': WS } }))).json()).records;
  eq(events.some((e) => e.kind === 'event' && e.type === 'comment' && e.taskId === chatTask.id && e.recipients?.includes('owner')), true, 'the owner hears about the client’s message');
  // The owner and admins delete a message: the bubble stays, emptied, saying who removed it; its files go.
  globalThis.testUser = member;
  const replyId = reply.records.find((r) => r.kind === 'comment' && r.attachments?.[0]?.id === clientPdf).id;
  eq((await mutate({ action: 'comment-delete', id: replyId })).status, 403, 'a team member cannot delete messages');
  globalThis.testUser = contact;
  eq((await mutate({ action: 'comment-delete', id: replyId })).status, 403, 'nor can the client');
  globalThis.testUser = owner;
  const removed = await (await mutate({ action: 'comment-delete', id: replyId })).json();
  const gone = removed.records.find((r) => r.id === replyId);
  eq([gone.name, gone.attachments, gone.audio, gone.deletedBy, typeof gone.deletedAt], ['', undefined, undefined, 'Owner', 'string'], 'the message is emptied and says who removed it');
  eq((await get(clientPdf)).status, 404, 'its file is deleted too');
  eq((await mutate({ action: 'comment-delete', id: 'nope' })).status, 404, 'an unknown message');
  globalThis.testUser = contact;
  const seenByClient = (await (await records.GET(new Request(origin + '/api/records', { headers: { 'X-Workspace-Id': WS } }))).json()).records.find((r) => r.id === replyId);
  eq([seenByClient?.name, !!seenByClient?.deletedAt], ['', true], 'the client sees it was deleted, not what it said');
  globalThis.testUser = owner;
  const current = events.find((r) => r.id === chatTask.id);
  await mutate({ action: 'delete', kind: 'task', id: chatTask.id, revision: current.revision });
  eq((await get(brief.data.id)).status, 404, 'deleting the task drops the files of its conversation');
}

// All media, original bytes, bounded uploads, private access and seekable downloads.
{
  eq(files.taskFileType('', 'REEL.MOV'), 'video/quicktime', 'phones without a MIME type infer it from the extension');
  eq(files.taskFileType('application/octet-stream', 'mix.flac'), 'audio/flac');
  eq(files.taskFileType('video/webm;codecs=vp9', 'reel.webm'), 'video/webm');
  eq(files.taskFileType('bad\r\nheader', 'x.unknown'), 'application/octet-stream');
  eq(files.previewImage('image/heic'), false, 'unsupported previews retain a download');
  eq(files.inlineTaskFile('image/svg+xml'), false, 'active image formats never execute on the app origin');
  for (const [name, type] of [['reel.mp4', 'video/mp4'], ['reel.mov', 'video/quicktime'], ['voice.mp3', 'audio/mpeg'], ['source.psd', 'image/vnd.adobe.photoshop'], ['bundle.zip', 'application/zip'], ['sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']]) {
    const result = await send('file', new File([png], name, { type }));
    eq(result.status, 200, name + ' accepted');
    const response = await get(result.data.id);
    eq(response.headers.get('content-type'), type, name + ' retains its type');
    eq(new Uint8Array(await response.arrayBuffer()), png, name + ' retains original bytes');
  }
  for (const [name, type] of [['page.html', 'text/html'], ['vector.svg', 'image/svg+xml']]) {
    const result = await send('file', new File(['<script>alert(1)</script>'], name, { type }));
    const response = await get(result.data.id);
    eq(response.headers.get('content-disposition').startsWith('attachment;'), true, 'active formats download safely');
    eq(response.headers.get('content-security-policy'), "sandbox; default-src 'none'");
  }
  eq((await startUpload({ name: 'empty.mp4', type: 'video/mp4', size: 0 })).status, 413);
  eq((await startUpload({ name: 'huge.mp4', type: 'video/mp4', size: 100_000_001 })).status, 413, '100 MB cap enforced server-side');
  const fakePdf = await (await startUpload({ name: 'fake.pdf', type: 'application/pdf', size: png.length })).json();
  await chunkRequest(fakePdf.id, 'PUT', png, '0');
  eq((await chunkRequest(fakePdf.id, 'POST')).status, 415, 'chunked PDF uploads keep signature validation');
  await chunkRequest(fakePdf.id, 'DELETE');
  const bytes = new Uint8Array(6_000_123); for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  const begun = await startUpload({ name: 'original.mov', type: '', size: bytes.length });
  eq(begun.status, 200); const { id } = await begun.json();
  eq((await get(id)).status, 404, 'incomplete uploads cannot be downloaded');
  const reserve = (await db.query('SELECT kind, size FROM assets WHERE id = $1', [id]))[0];
  eq(reserve, { kind: 'file-upload', size: bytes.length }, 'the whole file reserves storage once');
  eq((await chunkRequest(id, 'POST')).status, 409, 'completion requires every chunk');
  eq((await chunkRequest(id, 'PUT', bytes.slice(0, 3_000_001), '0')).status, 413, 'every HTTP request is bounded');
  eq((await chunkRequest(id, 'PUT', png, '0')).status, 400, 'short chunks are refused');
  eq((await chunkRequest(id, 'PUT', bytes.slice(0, 3_000_000), '0', { origin: 'https://evil.test' })).status, 403, 'CSRF gate');
  globalThis.testUser = member;
  eq((await chunkRequest(id, 'PUT', bytes.slice(0, 3_000_000), '0')).status, 404, 'another uploader cannot replace chunks');
  eq((await chunkRequest(id, 'POST')).status, 404, 'another uploader cannot finalize');
  await chunkRequest(id, 'DELETE');
  globalThis.testUser = owner;
  eq((await db.query('SELECT id FROM assets WHERE id = $1', [id])).length, 1, 'another uploader cannot cancel');
  // Arrival order is irrelevant. A network retry can repeat the same chunk without corrupting it.
  eq((await chunkRequest(id, 'PUT', bytes.slice(3_000_000, 6_000_000), '1')).status, 200);
  eq((await chunkRequest(id, 'PUT', bytes.slice(0, 3_000_000), '0')).status, 200);
  eq((await chunkRequest(id, 'PUT', bytes.slice(0, 3_000_000), '0')).status, 200, 'identical retry is idempotent');
  eq((await chunkRequest(id, 'PUT', new Uint8Array(3_000_000), '0')).status, 409, 'different duplicate bytes cannot overwrite');
  eq((await chunkRequest(id, 'PUT', bytes.slice(6_000_000), '2')).status, 200);
  eq(Number((await db.query("SELECT sum(size) AS n FROM assets WHERE id = $1 OR split_part(id, ':', 1) = $1", [id]))[0].n), bytes.length, 'chunks do not double count storage');
  const finished = await chunkRequest(id, 'POST'); eq(finished.status, 200);
  eq(await finished.json(), { id, type: 'video/quicktime', size: bytes.length });
  eq((await chunkRequest(id, 'POST')).status, 200, 'finalization retry is idempotent');
  eq((await db.query("SELECT id FROM assets WHERE split_part(id, ':', 1) = $1 AND kind = 'file-chunk'", [id])).length, 0, 'temporary chunks removed');
  const full = await get(id); eq(full.status, 200);
  eq(new Uint8Array(await full.arrayBuffer()), bytes, 'large stream reconstructs exact original bytes');
  const part = await get(id, { Range: 'bytes=2999990-3000020' });
  eq([part.status, part.headers.get('content-range'), part.headers.get('content-length')], [206, 'bytes 2999990-3000020/6000123', '31']);
  eq(new Uint8Array(await part.arrayBuffer()), bytes.slice(2_999_990, 3_000_021), 'seeking crosses chunk boundaries');
  const suffix = await get(id, { Range: 'bytes=-10' }); eq(suffix.status, 206); eq(new Uint8Array(await suffix.arrayBuffer()), bytes.slice(-10));
  for (const range of ['bytes=7000000-', 'bytes=20-10', 'bytes=-0', 'bytes=0-1,4-5', 'invalid']) eq((await get(id, { Range: range })).status, 416, 'invalid range refused');
  const head = await serve.HEAD(new Request(origin + '/api/assets/' + id, { method: 'HEAD' }), { params: Promise.resolve({ id }) });
  eq([head.status, head.headers.get('content-length'), await head.text()], [200, String(bytes.length), ''], 'HEAD reads metadata only');
  await chunkRequest(id, 'DELETE'); eq((await get(id)).status, 200, 'cancel never deletes a completed file');
  globalThis.testUser = contact; eq((await get(id)).status, 404, 'client cannot see an unattached studio upload');
  globalThis.testUser = owner;
  const mediaTask = await (await mutate({ action: 'create', kind: 'task', data: { name: 'Media task', clientId: client.id, status: 'En cours', due: futureDay, source: 'Interne', assignee: '' } })).json();
  eq((await mutate({ action: 'comment', taskId: mediaTask.id, text: '', attachments: [{ id, name: 'original.mov' }] })).status, 200, 'large media attaches to normal task messages');
  globalThis.testUser = contact; eq((await get(id)).status, 200, 'client sees the video on their own task');
  const clientUpload = await (await startUpload({ name: 'client-voice.wav', type: '', size: webm.length })).json();
  eq((await chunkRequest(clientUpload.id, 'PUT', webm, '0')).status, 200, 'clients can upload chunks too');
  eq((await chunkRequest(clientUpload.id, 'POST')).status, 200, 'client upload finalizes');
  eq((await mutate({ action: 'comment', taskId: mediaTask.id, text: '', attachments: [{ id: clientUpload.id, name: 'client-voice.wav' }] })).status, 200, 'client sends media in the same task chat');
  eq((await get(clientUpload.id)).headers.get('content-type'), 'audio/wav', 'extension inference is server authoritative');
  globalThis.testUser = outsider; eq((await get(id)).status, 404, 'outsiders cannot read large media');
  globalThis.testUser = owner;
  const cancelled = await (await startUpload({ name: 'cancel.mp4', type: 'video/mp4', size: 3_000_001 })).json();
  await chunkRequest(cancelled.id, 'PUT', bytes.slice(0, 3_000_000), '0');
  eq((await mutate({ action: 'comment', taskId: mediaTask.id, text: '', attachments: [{ id: cancelled.id, name: 'cancel.mp4' }] })).status, 400, 'incomplete upload cannot be attached');
  await chunkRequest(cancelled.id, 'DELETE');
  eq((await db.query("SELECT id FROM assets WHERE split_part(id, ':', 1) = $1", [cancelled.id])).length, 0, 'cancel releases chunks and reserved storage');
  const expired = await (await startUpload({ name: 'expired.mp4', type: 'video/mp4', size: 3_000_001 })).json();
  await chunkRequest(expired.id, 'PUT', bytes.slice(0, 3_000_000), '0');
  await db.query("UPDATE assets SET created_at = now() - interval '25 hours' WHERE id = $1", [expired.id]);
  eq((await chunkRequest(expired.id, 'POST')).status, 410, 'old upload sessions expire');
  const next = await (await startUpload({ name: 'next.mp4', type: 'video/mp4', size: 3_000_001 })).json();
  eq((await db.query("SELECT id FROM assets WHERE split_part(id, ':', 1) = $1", [expired.id])).length, 0, 'new uploads reclaim stale reservations and chunks');
  await chunkRequest(next.id, 'DELETE');
  await db.query("INSERT INTO users (id, name, email, password_hash) VALUES ('viewer', 'Viewer', 'viewer@studio.test', 'x')");
  await db.query("INSERT INTO workspace_members (workspace_id, user_id, role, name, email) VALUES ($1, 'viewer', 'viewer', 'Viewer', 'viewer@studio.test')", [WS]);
  globalThis.testUser = { ...owner, userId: 'viewer' };
  eq((await startUpload({ name: 'no.mp4', type: 'video/mp4', size: 6_000_000 })).status, 403, 'viewers cannot upload');
  globalThis.testUser = owner;
}

// Deleting a client takes its posting calendar and its uploaded images with it.
const doomed = await (await mutate({ action: 'create', kind: 'client', data: { name: 'Client Supprimé' } })).json();
const doomedLogo = (await send('logo', new File([png], 'gone.png', { type: 'image/png' }))).data.id;
await mutate({ action: 'update', kind: 'client', id: doomed.id, revision: 1, data: { name: 'Client Supprimé', logo: doomedLogo } });
const doomedPost = await (await mutate({ action: 'create', kind: 'editorial_post', data: { name: 'Post orphelin', clientId: doomed.id, due: '2026-12-01' } })).json();
const afterDelete = await (await mutate({ action: 'delete', kind: 'client', id: doomed.id, revision: 2 })).json();
eq(afterDelete.records.some((r) => r.id === doomedPost.id), false, 'the client\u2019s posting calendar goes with it');
eq((await get(doomedLogo)).status, 404, 'the client\u2019s logo is dropped too');

await pg.close();
console.log(`${checks} image checks passed: upload rules, member-only serving, replacement cleanup, profile pictures, voice messages, files in task conversations.`);
