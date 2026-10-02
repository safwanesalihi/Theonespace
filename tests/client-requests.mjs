import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const esbuildPath = globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0];
const esbuild = await import(pathToFileURL(esbuildPath));
mkdirSync('.sites-runtime', { recursive: true });
await esbuild.build({ entryPoints: ['lib/records-client.ts'], outfile: '.sites-runtime/records-client-test.mjs', bundle: true, platform: 'node', format: 'esm' });
const { sendRecordMutation, connectionError, serverResponseError } = await import(pathToFileURL(`${process.cwd()}/.sites-runtime/records-client-test.mjs`));
const body = { action: 'request', clientId: 'client-a', data: { name: 'طلب محتوى', priority: 'Haute', submissionId: crypto.randomUUID() } };
const success = () => Response.json({ id: 'request-a', records: [], workspace: { id: 'studio-a' } });
const originalFetch = globalThis.fetch;
let checks = 0;
async function scenario(replies, input = body) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, ...options });
    const next = replies.shift();
    assert.ok(next, 'no unexpected extra retry'); checks++;
    if (next instanceof Error) throw next;
    return next();
  };
  const result = await sendRecordMutation(input, 'studio-a').catch(error => error);
  return { result, calls };
}
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
try {
  for (const failure of [new TypeError('Failed to fetch'), () => new Response('Internal server error', { status: 500 }), () => new Response('<html>Gateway error</html>', { status: 502 }), () => Response.json({ error: 'Temporary save failure' }, { status: 503 }), () => new Response('FUNCTION_INVOCATION_TIMEOUT', { status: 504 }), () => new Response('<html>Unexpected login page</html>', { status: 200 })]) {
    const { result, calls } = await scenario([failure, success]);
    eq([result.ok, result.data.id, calls.length], [true, 'request-a', 2], 'a keyed request recovers from a lost connection or invalid server response');
    eq(calls.map(c => [c.url, c.method, c.body, c.headers['X-Workspace-Id']]), Array.from({ length: 2 }, () => ['/api/records', 'POST', JSON.stringify(body), 'studio-a']), 'retries use identical content, submission key and workspace');
  }
  for (const status of [400, 401, 403, 409, 429]) {
    const { result, calls } = await scenario([() => Response.json({ error: 'Explicit refusal', code: 'test-code' }, { status })]);
    eq([result.ok, result.status, result.data.error, result.data.code, calls.length], [false, status, 'Explicit refusal', 'test-code', 1], 'validation, access and rate-limit failures are not retried');
  }
  const blocked = await scenario([() => new Response('<html>Forbidden</html>', { status: 403 })]);
  eq(blocked.result.ok, false, 'an HTML access refusal is never treated as successful');
  eq(blocked.result.data.error.includes('refusé'), true, 'an HTML access refusal does not blame the internet');
  const partialError = await scenario([() => Response.json({ message: 'Access denied' }, { status: 403 })]);
  eq(partialError.result.data.error.includes('refusé'), true, 'a refusal without the expected error field still gives a readable explanation');
  const unavailable = await scenario([() => new Response('Service unavailable', { status: 503 }), () => new Response('Service unavailable', { status: 503 })]);
  eq([unavailable.result.ok, unavailable.result.data.error, unavailable.calls.length], [false, serverResponseError, 2], 'persistent server failures are reported honestly and stop after one retry');
  const offline = await scenario([new TypeError('Failed to fetch'), new TypeError('Failed to fetch')]);
  eq([offline.result.message, offline.calls.length], [connectionError, 2], 'persistent connection failures preserve the existing friendly message');
  const unconfirmed = await scenario([() => Response.json({}), () => Response.json({})]);
  eq([unconfirmed.result.ok, unconfirmed.result.data.error], [false, serverResponseError], 'a request without a receipt and records cannot report success');
  for (const input of [{ action: 'request', data: { name: 'Legacy form' } }, { action: 'create', data: { name: 'Normal task' } }, { action: 'request', data: { submissionId: 'invalid' } }]) {
    const { result, calls } = await scenario([new TypeError('Failed to fetch')], input);
    eq([result.message, calls.length], [connectionError, 1], 'writes without a valid request submission key are never retried automatically');
  }
  const malformed = await scenario([() => new Response('An HTML error masquerading as success', { status: 200 })], { action: 'create' });
  eq([malformed.result.ok, malformed.result.data.error], [false, serverResponseError], 'other writes cannot report success for an invalid response either');
} finally { globalThis.fetch = originalFetch; }
console.log(`${checks} client request transport checks passed: recovery, stable keys, server errors, access refusals and bounded retries.`);
