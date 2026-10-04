// Owner-only finance dashboard (/admin/finance): nobody but OWNER_EMAIL gets anything but a 404 —
// not the page, not the raw file, not the upload — and the proxy answers them as a missing address.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';

const esbuildPath = globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0] || 'node_modules/esbuild/lib/main.js';
const esbuild = await import(pathToFileURL(esbuildPath));
mkdirSync('.sites-runtime', { recursive: true });
const bundle = async (entry, out) => {
  await esbuild.build({
    entryPoints: [entry], outfile: `.sites-runtime/${out}`, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic',
    loader: { '.css': 'empty' }, external: ['react', 'react/*', 'react-dom', 'react-dom/*', 'lucide-react'],
    // The real Next helpers (notFound, NextResponse…), loaded from node_modules; next has no exports map, hence the .js.
    plugins: [testRuntimePlugin({ auth: false, after: false }), { name: 'next-cjs', setup(build) {
      build.onResolve({ filter: /^next\/(navigation|server|link)$/ }, (args) => ({ path: `${args.path}.js`, external: true }));
    } }],
  });
  return import(pathToFileURL(`${process.cwd()}/.sites-runtime/${out}`));
};
// Set before the bundles load: each one binds lib/env to this object once.
const { db, pg } = await createTestDb();
globalThis.testDb = db;
globalThis.testEnv = { OWNER_EMAIL: 'owner@studio.test' };
const route = await bundle('app/admin/finance/data/route.ts', 'finance-route-test.mjs');
const page = await bundle('app/admin/finance/page.tsx', 'finance-page-test.mjs');
const { proxy, config } = await bundle('proxy.ts', 'finance-proxy-test.mjs');

await pg.query("INSERT INTO workspaces (id, name, created_by) VALUES ('ws:owner', 'The One Space', 'owner')");

const owner = { userId: 'owner', fullName: 'Owner', displayName: 'Owner', email: 'Owner@Studio.test', avatar: null, mustChangePassword: false };
const visitors = {
  'signed out': undefined,
  'another account': { userId: 'nina', fullName: 'Nina', displayName: 'Nina', email: 'nina@studio.test', avatar: null, mustChangePassword: false },
  'a look-alike address': { ...owner, userId: 'fake', email: 'owner@studio.test.evil' },
  'the owner on a temporary password': { ...owner, mustChangePassword: true },
};
const as = (user) => { globalThis.testUser = user; };
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const B = 'https://tracker.test';
const is404 = async (fn, label) => {
  try { await fn(); } catch (error) { ok(String(error?.digest || '').startsWith('NEXT_HTTP_ERROR_FALLBACK;404'), `${label}: ${error}`); return; }
  assert.fail(`${label}: expected the ordinary 404`);
};
const put = (body, headers = {}) => route.PUT(new Request(`${B}/admin/finance/data`, { method: 'PUT', body, headers: { 'Content-Type': 'text/html', origin: B, ...headers } }));
const html = '<!DOCTYPE html><html lang="fr"><body><h1>Tableau de Bord Financier 2026</h1><script>1</script></body></html>';

ok(JSON.stringify(config.matcher) === JSON.stringify(['/admin/finance', '/admin/finance/:path*']), 'the proxy covers the page and everything under it, nothing else');

// (a), (b): anyone but the owner — the page, the raw file and the upload all answer 404; the proxy rewrites to a missing path.
for (const [label, user] of Object.entries(visitors)) {
  as(user);
  await is404(() => page.default(), `${label} · page`);
  await is404(() => route.GET(new Request(`${B}/admin/finance/data`)), `${label} · raw file`);
  await is404(() => put(html), `${label} · upload`);
  const answer = await proxy(new Request(`${B}/admin/finance`));
  ok(new URL(answer.headers.get('x-middleware-rewrite')).pathname === '/__not-found', `${label} · proxy answers as a missing address`);
}

// (c): the owner — the page renders, with nothing imported yet; the upload is checked, then stored.
as(owner);
ok((await proxy(new Request(`${B}/admin/finance/data`))).headers.get('x-middleware-next') === '1', 'the proxy lets the owner through');
let element = await page.default();
ok(element.props.info === null, 'the owner sees the page, with nothing imported yet');
await is404(() => route.GET(new Request(`${B}/admin/finance/data`)), 'owner · no file yet');
ok((await put(html, { origin: 'https://evil.test' })).status === 403, 'an upload from another origin is refused');
ok((await put(html, { 'Content-Type': 'application/json' })).status === 415, 'only an HTML body is accepted');
ok((await put('just text')).status === 400, 'a file that is not an HTML page is refused');
ok((await put('<html>' + 'x'.repeat(2 * 1024 * 1024) + '</html>')).status === 413, 'more than 2 MB is refused');
const saved = await put(html, { 'X-File-Name': encodeURIComponent('TheOneCore_Dashboard_2026.html') });
ok(saved.status === 200, 'the owner uploads the export');
const info = await saved.json();
ok(info.name === 'TheOneCore_Dashboard_2026.html' && info.size === new TextEncoder().encode(html).length && !!info.updatedAt, 'name, size and date are kept');
element = await page.default();
ok(element.props.info?.name === 'TheOneCore_Dashboard_2026.html', 'the page shows the imported file');
const file = await route.GET(new Request(`${B}/admin/finance/data`));
ok(file.status === 200 && (await file.text()) === html, 'the owner gets the file back unchanged');
const csp = file.headers.get('content-security-policy') || '';
ok(csp.includes('sandbox allow-scripts') && !csp.includes('allow-same-origin') && csp.includes("default-src 'none'"), 'even opened directly, the file runs sandboxed and can load or send nothing');
ok(file.headers.get('cache-control')?.includes('no-store') && file.headers.get('x-robots-tag')?.includes('noindex'), 'never cached, never indexed');

// (d): the stored file never reaches anyone else, and never travels with the app's records.
for (const [label, user] of Object.entries(visitors)) {
  as(user);
  await is404(() => route.GET(new Request(`${B}/admin/finance/data?v=${encodeURIComponent(info.updatedAt)}`)), `${label} · raw file after upload`);
}
const rows = await db.query("SELECT kind FROM records WHERE id = 'finance-dashboard:ws:owner'");
ok(rows.length === 1 && rows[0].kind === 'meta', "stored as a 'meta' row, which the records payload never includes");

// A newer export replaces the old one.
as(owner);
await put(html.replace('2026', '2027'));
ok((await (await route.GET(new Request(`${B}/admin/finance/data`))).text()).includes('2027'), 'a newer export replaces the old one');

await pg.close();
console.log(`${checks} finance checks passed: 404 for signed-out, other accounts, look-alikes and temporary passwords (page, raw file, upload, proxy); owner page, upload rules, sandboxed file, replacement.`);
