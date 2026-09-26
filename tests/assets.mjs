// Client images: upload by studio roles only, served to workspace members only, replaced images dropped.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';

const esbuildPath = globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0] || 'node_modules/esbuild/lib/main.js';
const esbuild = await import(pathToFileURL(esbuildPath));
mkdirSync('.sites-runtime/assets-tests', { recursive: true });
await esbuild.build({
  entryPoints: { upload: 'app/api/assets/route.ts', serve: 'app/api/assets/[id]/route.ts', records: 'app/api/records/route.ts' },
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

let checks = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const origin = 'https://tracker.test';
const WS = 'ws:owner';
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
async function send(kind, file, headers = {}) {
  const body = new FormData(); body.append('kind', kind); if (file) body.append('file', file);
  const r = await upload.POST(new Request(origin + '/api/assets', { method: 'POST', headers: { origin, 'X-Workspace-Id': WS, ...headers }, body }));
  return { status: r.status, data: await r.json() };
}
const get = (id) => serve.GET(new Request(origin + '/api/assets/' + id), { params: Promise.resolve({ id }) });
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
const task = await (await mutate({ action: 'create', kind: 'task', data: { name: 'Voice task', clientId: client.id, projectId: project.id, status: 'En cours', due: '2026-10-10', source: 'Interne', assignee: '' } })).json();
await mutate({ action: 'update', kind: 'task', id: task.id, revision: 1, data: { name: 'Voice task', clientId: client.id, projectId: project.id, status: 'À valider', due: '2026-10-10', source: 'Interne', assignee: '', deliverable: 'https://example.com/v1.pdf' } });
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
  const chatTask = await (await mutate({ action: 'create', kind: 'task', data: { name: 'Chat task', clientId: client.id, projectId: project.id, status: 'En cours', due: '2026-10-12', source: 'Interne', assignee: '' } })).json();
  const other = await (await mutate({ action: 'create', kind: 'client', data: { name: 'Autre client' } })).json();
  const otherTask = await (await mutate({ action: 'create', kind: 'task', data: { name: 'Other chat', clientId: other.id, status: 'En cours', due: '2026-10-12', source: 'Interne', assignee: '' } })).json();
  const brief = (await send('file', new File([pdf], 'Brief final.pdf', { type: 'application/pdf' })));
  eq(brief.status, 200, 'the studio sends a PDF');
  eq((await send('file', new File([png], 'fake.pdf', { type: 'application/pdf' }))).status, 415, 'a file that only claims to be a PDF is refused');
  eq((await send('file', new File([pdf], 'x.exe', { type: 'application/x-msdownload' }))).status, 415, 'other types are refused');
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
