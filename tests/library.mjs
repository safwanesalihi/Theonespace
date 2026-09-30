// The Bibliothèque (lib/library.ts, lib/link-preview.ts, /api/records « library », /api/library/preview):
// what a paste becomes, duplicates, prompt blanks, tags, who may change an entry, favourites and use
// counts, and the link reader that must never reach a private address.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';

const esbuildPath = globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0] || 'node_modules/esbuild/lib/main.js';
const esbuild = await import(pathToFileURL(esbuildPath));
mkdirSync('.sites-runtime', { recursive: true });
const { db, pg } = await createTestDb();
globalThis.testDb = db;
globalThis.testEnv = { OWNER_EMAIL: 'owner@studio.test', AUTH_URL: 'https://space.test' };
const bundle = async (entry, out) => {
  await esbuild.build({ entryPoints: [entry], outfile: `.sites-runtime/${out}`, bundle: true, platform: 'node', format: 'esm', plugins: [testRuntimePlugin({ auth: false })] });
  return import(pathToFileURL(`${process.cwd()}/.sites-runtime/${out}`));
};
const records = await bundle('app/api/records/route.ts', 'lib-records.mjs');
const previewRoute = await bundle('app/api/library/preview/route.ts', 'lib-preview-route.mjs');
const lib = await bundle('lib/library.ts', 'lib-library.mjs');
const lp = await bundle('lib/link-preview.ts', 'lib-link-preview.mjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const WS = 'ws:owner';
const B = 'https://space.test';
const owner = { userId: 'owner', fullName: 'Owner', displayName: 'Owner', email: 'owner@studio.test' };
const as = (user) => { globalThis.testUser = user; };
as(owner);
const post = async (body, status = 200) => {
  const r = await records.POST(new Request(`${B}/api/records`, { method: 'POST', headers: { 'Content-Type': 'application/json', origin: B, 'X-Workspace-Id': WS }, body: JSON.stringify(body) }));
  const d = await r.json(); assert.equal(r.status, status, JSON.stringify(d).slice(0, 300)); checks++; return d;
};
const entry = async (id) => { const r = (await pg.query('SELECT data, revision FROM records WHERE id = $1', [id])).rows[0]; return r && { ...(typeof r.data === 'string' ? JSON.parse(r.data) : r.data), revision: r.revision }; };
await records.GET(new Request(`${B}/api/records`));
const people = async (id, role) => {
  await pg.query('INSERT INTO users (id, name, email, password_hash) VALUES ($1, $1, $2, $3)', [id, `${id}@studio.test`, 'x']);
  await pg.query('INSERT INTO workspace_members (workspace_id, user_id, role, name, email) VALUES ($1, $2, $3, $2, $4)', [WS, id, role, `${id}@studio.test`]);
  return { userId: id, fullName: id, displayName: id, email: `${id}@studio.test` };
};
const sara = await people('sara', 'creative');
const adam = await people('adam', 'creative');
const admin = await people('boss', 'admin');
const viewer = await people('view', 'viewer');
const kojo = await post({ action: 'create', kind: 'client', data: { name: 'Kojo Bakery' } });

// 1. The helpers: a paste, a link's identity, prompt blanks, tags.
{
  eq(lib.guessPaste('https://chromewebstore.google.com/detail/colorzilla/abc'), { category: 'plugin', link: 'https://chromewebstore.google.com/detail/colorzilla/abc' }, 'a store link is a plugin');
  eq(lib.guessPaste('https://drive.google.com/drive/folders/x').category, 'asset', 'a Drive folder is an asset');
  eq(lib.guessPaste(' https://coolors.co ').category, 'website', 'any other link is a useful site');
  eq(lib.guessPaste('Écris une accroche\npour {client}'), { category: 'prompt', content: 'Écris une accroche\npour {client}' }, 'a text is a prompt, line breaks kept');
  eq(lib.linkKey('https://www.Coolors.co/?utm_source=x#top'), lib.linkKey('http://coolors.co'), 'the same site, whatever the protocol, www, trailing slash or tracking tags');
  ok(lib.linkKey('https://coolors.co/palettes') !== lib.linkKey('https://coolors.co'), 'another page is another link');
  eq(lib.promptVariables('Pour {client}, un post sur {produit} — {client} encore'), ['client', 'produit'], 'each blank once, in order');
  eq(lib.fillPrompt('Pour {client}, {produit}', { client: 'Kojo', produit: '' }), 'Pour Kojo, {produit}', 'filled; an empty blank stays');
  eq(lib.cleanTags(['#Reel', 'reel', '  Ramadan  2026 ', '', ...Array(20).fill(0).map((_, i) => `t${i}`)]).slice(0, 3), ['Reel', 'Ramadan 2026', 't0'], 'tags tidied, one of each');
  eq(lib.cleanTags(Array(20).fill(0).map((_, i) => `t${i}`)).length, 10, 'ten at most');
}

// 2. Adding: a prompt with its tool, blanks, tags and client; a link with its icon.
let prompt, link;
{
  as(sara);
  prompt = (await post({ action: 'create', kind: 'library', data: { name: 'Accroche Reel', category: 'prompt', content: 'Écris une accroche pour {client}.', tool: 'ChatGPT', tags: ['#Reel', 'reel', 'Hook'], clientId: kojo.id, example: 'https://drive.google.com/file/d/ex' } })).id;
  const p = await entry(prompt);
  eq([p.tool, p.tags, p.clientId, p.example, p.authorId, p.author], ['ChatGPT', ['Reel', 'Hook'], kojo.id, 'https://drive.google.com/file/d/ex', 'sara', 'sara'], 'saved with its tool, tidy tags, client, example and author');
  ok(p.history[0].text === 'Ajouté par sara', 'the history says who added it');
  link = (await post({ action: 'create', kind: 'library', data: { name: 'Coolors', category: 'website', link: 'https://coolors.co/', icon: 'https://coolors.co/favicon.ico', description: 'Palettes' } })).id;
  eq((await entry(link)).icon, 'https://coolors.co/favicon.ico', 'a link keeps its icon');
  await post({ action: 'create', kind: 'library', data: { name: 'Vide', category: 'prompt', content: '' } }, 400);
  await post({ action: 'create', kind: 'library', data: { name: 'Sans lien', category: 'plugin' } }, 400);
  await post({ action: 'create', kind: 'library', data: { name: 'X', category: 'prompt', content: 'x', clientId: 'nobody' } }, 400);
}

// 3. The same link twice: said, unless confirmed.
{
  const d = await post({ action: 'create', kind: 'library', data: { name: 'Coolors bis', category: 'website', link: 'http://www.coolors.co?utm_source=ig' } }, 409);
  eq([d.code, d.id, /« Coolors »/.test(d.error)], ['duplicate', link, true], 'a duplicate names the entry already there');
  const again = await post({ action: 'create', kind: 'library', data: { name: 'Coolors bis', category: 'website', link: 'http://www.coolors.co?utm_source=ig' }, allowDuplicate: true });
  ok(again.id && again.id !== link, 'added anyway once confirmed');
  await post({ action: 'delete', kind: 'library', id: again.id, revision: 1 });
}

// 4. Who changes what: the author, the owner and admins; another member duplicates instead.
{
  const p = await entry(prompt);
  as(adam);
  eq((await post({ action: 'update', kind: 'library', id: prompt, revision: p.revision, data: { name: 'Mine now', category: 'prompt', content: 'x' } }, 403)).error, 'Seuls son auteur, le propriétaire et les administrateurs peuvent modifier cette ressource.', 'another member cannot edit it');
  await post({ action: 'delete', kind: 'library', id: prompt, revision: p.revision }, 403);
  as(sara);
  await post({ action: 'update', kind: 'library', id: prompt, revision: p.revision, data: { name: 'Accroche Reel v2', category: 'prompt', content: 'Écris une accroche pour {client}.', tool: 'Claude', tags: ['Reel'] } });
  const v2 = await entry(prompt);
  eq([v2.name, v2.tool, v2.authorId, v2.clientId], ['Accroche Reel v2', 'Claude', 'sara', undefined], 'the author edits it; a cleared client is cleared, the author kept');
  as(admin);
  await post({ action: 'update', kind: 'library', id: prompt, revision: v2.revision, data: { name: 'Accroche Reel v3', category: 'prompt', content: 'Nouveau texte', tags: [] } });
  eq((await entry(prompt)).name, 'Accroche Reel v3', 'an admin edits anyone’s');
  // A category change keeps only what the new category uses.
  as(sara);
  const v3 = await entry(prompt);
  await post({ action: 'update', kind: 'library', id: prompt, revision: v3.revision, data: { name: 'Now a link', category: 'plugin', link: 'https://figma.com/community/plugin/1', content: 'ignored', tool: 'ignored' } });
  const v4 = await entry(prompt);
  eq([v4.category, v4.link, v4.content, v4.tool], ['plugin', 'https://figma.com/community/plugin/1', undefined, undefined], 'turned into a plugin: the prompt text and tool are dropped');
  // An older entry with no author id belongs to the name it carries.
  await pg.query("INSERT INTO records (id, owner, workspace_id, kind, data, revision) VALUES ('old-1', 'owner', $1, 'library', $2::jsonb, 1)", [WS, JSON.stringify({ name: 'Ancien', category: 'prompt', content: 'x', author: 'adam', createdAt: new Date().toISOString() })]);
  await post({ action: 'update', kind: 'library', id: 'old-1', revision: 1, data: { name: 'Ancien', category: 'prompt', content: 'y' } }, 403);
  as(adam);
  await post({ action: 'update', kind: 'library', id: 'old-1', revision: 1, data: { name: 'Ancien', category: 'prompt', content: 'y' } });
  eq((await entry('old-1')).authorId, undefined, 'an old entry is edited by the person named on it, and stays theirs by name');
  as(viewer);
  await post({ action: 'create', kind: 'library', data: { name: 'x', category: 'prompt', content: 'y' } }, 403);
}

// 5. Favourites are personal; uses are counted without touching the revision.
{
  as(sara);
  const before = await entry(link);
  await post({ action: 'library-favorite', id: link, on: true });
  await post({ action: 'library-favorite', id: link, on: true });
  as(adam);
  await post({ action: 'library-favorite', id: link, on: true });
  eq((await entry(link)).favoriteBy.sort(), ['adam', 'sara'], 'each person stars it once');
  await post({ action: 'library-favorite', id: link, on: false });
  eq((await entry(link)).favoriteBy, ['sara'], 'unstarring removes only yours');
  as(viewer);
  await post({ action: 'library-used', id: link });
  const used = await post({ action: 'library-used', id: link });
  eq(used, { ok: true }, 'a use answers without the whole workspace');
  const after = await entry(link);
  eq([after.copies, after.revision], [2, before.revision], 'counted twice, the revision untouched so nobody’s edit conflicts');
  await post({ action: 'library-used', id: 'nope' }, 404);
}

// 6. The link reader: public pages only, redirects checked again, title and icon read.
{
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) ok(lp.privateAddress(ip), `${ip} is private`);
  for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700::1111']) ok(!lp.privateAddress(ip), `${ip} is public`);
  const hits = [];
  const page = '<html><head><title>Ignored</title><meta property="og:title" content="Coolors &amp; Palettes"><meta name="description" content="Make palettes"><meta property="og:site_name" content="Coolors"><link rel="shortcut icon" href="/img/fav.png"></head><body></body></html>';
  const fetcher = async (url) => {
    hits.push(String(url));
    if (String(url).includes('/go-private')) return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin' } });
    if (String(url).includes('/go-public')) return new Response(null, { status: 301, headers: { location: '/page' } });
    return new Response(page, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  };
  eq(await lp.linkPreview('http://93.184.216.34/page', fetcher), { title: 'Coolors & Palettes', site: 'Coolors', icon: 'http://93.184.216.34/img/fav.png', description: 'Make palettes' }, 'title, site, icon and description from the page');
  for (const bad of ['http://127.0.0.1/', 'http://localhost/x', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data', 'http://93.184.216.34:8080/', 'ftp://93.184.216.34/', 'http://user:pw@93.184.216.34/', 'http://printer.local/']) {
    const n = hits.length;
    eq(await lp.linkPreview(bad, fetcher), null, `refused: ${bad}`);
    eq(hits.length, n, `and never fetched: ${bad}`);
  }
  hits.length = 0;
  eq(await lp.linkPreview('http://93.184.216.34/go-private', fetcher), null, 'a redirect to a private address is not followed');
  eq(hits, ['http://93.184.216.34/go-private'], 'only the first, public hop was fetched');
  eq((await lp.linkPreview('http://93.184.216.34/go-public', fetcher)).title, 'Coolors & Palettes', 'a public redirect is followed');

  const ask = async (body, status) => {
    const r = await previewRoute.POST(new Request(`${B}/api/library/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json', origin: B, 'X-Workspace-Id': WS }, body: JSON.stringify(body) }));
    assert.equal(r.status, status); checks++; return r.json();
  };
  as(sara);
  eq((await ask({ url: 'http://127.0.0.1/' }, 422)).error, 'Ce lien ne peut pas être lu.', 'the route refuses a private address');
  await ask({ url: 42 }, 400);
  const client = await people('client1', 'client');
  as(client);
  await ask({ url: 'http://93.184.216.34/' }, 403);
  as(null);
  await ask({ url: 'http://93.184.216.34/' }, 401);
}

await pg.close();
console.log(`${checks} library checks passed: pastes, duplicates, prompt blanks, tags, who edits, category changes, favourites and uses, the link reader and its private-address guard.`);
