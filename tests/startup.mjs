import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
const esbuild = await import(pathToFileURL(globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0]));
mkdirSync('.sites-runtime/startup', { recursive: true });
await esbuild.build({ entryPoints: ['lib/workspace-loader.ts', 'lib/startup-recovery.ts', 'lib/media-query.ts'], outdir: '.sites-runtime/startup', bundle: true, platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' } });
const load = (name) => import(pathToFileURL(`${process.cwd()}/.sites-runtime/startup/${name}.mjs`));
const { WorkspaceLoader, workspaceTimeoutError, workspaceLoadError } = await load('workspace-loader');
const { startupRecovery } = await load('startup-recovery');
const { watchMediaQuery } = await load('media-query');
let checks = 0;
const eq = (a, b, message) => { assert.deepEqual(a, b, message); checks++; };
const valid = (id) => ({ records: [{ kind: 'client', id: 'my-client' }], members: [], workspace: { id, role: 'client', clientId: 'my-client' }, user: { id: 'client-user' } });
const originalFetch = globalThis.fetch;
try {
  // Reproduce a slow sign-in while three polling ticks fire: there must still be one request,
  // and its client payload must be delivered rather than repeatedly invalidated.
  const calls = []; let resolveInitial;
  globalThis.fetch = (url, options) => { calls.push([url, options]); return new Promise(resolve => { resolveInitial = resolve; }); };
  const reader = new WorkspaceLoader();
  const initial = reader.read({ workspaceId: 'studio' });
  for (let tick = 0; tick < 3; tick++) eq(await reader.read({ workspaceId: 'studio', silent: true }), null, 'poll waits for initial sign-in');
  eq(calls.length, 1, 'slow sign-in is never superseded by polling');
  resolveInitial(Response.json(valid('studio')));
  eq((await initial).data.workspace.role, 'client', 'client sign-in response arrives');
  eq(reader.pending, false, 'read slot released');
  eq(calls[0][1].cache, 'no-store', 'authenticated reads bypass browser cache');

  const deferred = [];
  globalThis.fetch = (_url, options) => new Promise(resolve => deferred.push({ options, resolve }));
  const poll = reader.read({ workspaceId: 'old', silent: true });
  const switchRead = reader.read({ workspaceId: 'new' });
  eq(deferred[0].options.signal.aborted, true, 'explicit workspace switch aborts stale poll');
  deferred[1].resolve(Response.json(valid('new')));
  eq((await switchRead).data.workspace.id, 'new', 'new workspace wins');
  deferred[0].resolve(Response.json(valid('old')));
  eq(await poll, null, 'late old workspace never overwrites current client');

  globalThis.fetch = (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
  const timed = new WorkspaceLoader(5);
  await assert.rejects(timed.read({}), { message: workspaceTimeoutError }); checks++;
  eq(timed.pending, false, 'timeout releases loading state');
  const cancelled = new WorkspaceLoader(); const cancelledRead = cancelled.read({}); cancelled.cancel();
  eq(await cancelledRead, null, 'unmount cancellation is quiet');

  const deniedCalls = [];
  globalThis.fetch = async (_url, options) => { deniedCalls.push(options.headers); return deniedCalls.length === 1 ? Response.json({ error: 'Access revoked' }, { status: 403 }) : Response.json(valid('allowed-studio')); };
  eq((await reader.read({ workspaceId: 'other-account-studio' })).data.workspace.id, 'allowed-studio', 'stale browser workspace resolves through server membership');
  eq(deniedCalls, [{ 'X-Workspace-Id': 'other-account-studio' }, {}], 'only one fallback, without granting access');
  for (const [status, code] of [[401, undefined], [403, 'no-workspace'], [403, 'password-change-required'], [429, undefined], [503, undefined]]) {
    let count = 0;
    globalThis.fetch = async () => { count++; return Response.json({ error: 'Refused', code }, { status }); };
    const result = await reader.read({ workspaceId: 'studio' });
    eq([result.response.status, result.data.code, count], [status, code, 1], 'authentication, password and server refusals are preserved');
  }
  for (const data of [{}, { records: [] }, { ...valid('studio'), user: null }]) {
    globalThis.fetch = async () => Response.json(data);
    await assert.rejects(reader.read({}), { message: workspaceLoadError }); checks++;
  }
  globalThis.fetch = async () => new Response('<html>Gateway failure</html>', { status: 502 });
  eq((await reader.read({})).data.error, workspaceLoadError, 'HTML server errors have readable recovery');
  let headers;
  globalThis.fetch = async (_url, options) => { headers = options.headers; return new Response(null, { status: 304 }); };
  eq((await reader.read({ workspaceId: 'studio', etag: 'revision', silent: true })).data, null, '304 has no JSON body');
  eq(headers['If-None-Match'], 'revision', 'conditional polls retained');
} finally { globalThis.fetch = originalFetch; }

function boot({ href = 'https://space.the1core.com/#portal/client/home', blocked = false, offline = false, previous = null, locale = null } = {}) {
  const listeners = {}, elements = [], navigations = [];
  const element = tag => ({ tagName: tag.toUpperCase(), style: {}, children: [], setAttribute() {}, appendChild(child) { this.children.push(child); } });
  const document = { getElementById: id => elements.find(e => e.id === id), createElement: element, body: { appendChild: e => elements.push(e) } };
  const location = { href, origin: new URL(href).origin, replace: url => navigations.push(url) };
  const storage = { value: previous, getItem() { if (blocked) throw Error('Storage blocked'); return this.value; }, setItem(_key, value) { if (blocked) throw Error('Storage blocked'); this.value = value; } };
  const saved = locale ? { localStorage: { getItem: () => locale } } : {};
  runInNewContext(startupRecovery, { window: { addEventListener: (event, handler) => { listeners[event] = handler; } }, location, navigator: { onLine: !offline }, document, sessionStorage: storage, URL, Date, ...saved });
  return { listeners, elements, navigations };
}
const stale = boot();
stale.listeners.error({ target: { tagName: 'SCRIPT', src: 'https://space.the1core.com/_next/static/chunks/removed.js' } });
eq(stale.navigations.length, 1, 'missing deployment chunk retries document once');
eq(new URL(stale.navigations[0]).hash, '#portal/client/home', 'recovery retains client destination');
stale.listeners.unhandledrejection({ reason: Error('ChunkLoadError: Loading chunk 3 failed') });
eq(stale.navigations.length, 1, 'multiple chunk failures do not reload repeatedly');
const repeated = boot({ href: stale.navigations[0], blocked: true });
repeated.listeners.error({ message: 'Failed to load chunk' });
eq([repeated.navigations.length, repeated.elements.length], [0, 1], 'even blocked storage cannot produce a reload loop');
eq(repeated.elements[0].children[2].textContent, 'Réessayer', 'failure exposes a working manual retry link');
const offline = boot({ offline: true }); offline.listeners.error({ message: 'ChunkLoadError' });
eq([offline.navigations.length, offline.elements.length], [0, 1], 'offline clients get retry screen rather than reload loop');
const arabic = boot({ offline: true, locale: 'ar' }); arabic.listeners.error({ message: 'ChunkLoadError' });
eq(arabic.elements[0].children[2].textContent, 'إعادة المحاولة', 'the retry screen speaks the saved language');
const normal = boot();
normal.listeners.error({ message: 'Validation failed' });
normal.listeners.error({ target: { tagName: 'IMG', src: 'https://example.test/image.png' } });
normal.listeners.error({ target: { tagName: 'SCRIPT', src: 'https://apis.google.com/js/api.js' } });
eq(normal.navigations.length, 0, 'ordinary errors, images and third-party scripts never force reload');

for (const legacy of [false, true]) {
  const calls = [], query = legacy ? { addListener: cb => calls.push(['add', cb]), removeListener: cb => calls.push(['remove', cb]) } : { addEventListener: (name, cb) => calls.push([name, cb]), removeEventListener: (name, cb) => calls.push(['remove-' + name, cb]) };
  const listener = () => {}; const cleanup = watchMediaQuery(query, listener); cleanup();
  eq(calls.length, 2, 'modern and legacy mobile queries subscribe and clean up');
  eq(calls[0][1] === listener && calls[1][1] === listener, true, 'same listener removed');
}
console.log(`${checks} startup checks passed: slow client sign-in, refresh races, bounded reads, deployment recovery, access gates and mobile browser listeners.`);
