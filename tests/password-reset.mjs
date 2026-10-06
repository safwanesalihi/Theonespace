// « Mot de passe oublié ? » (lib/password-reset.ts): a link only for real accounts but the same answer
// for everyone, a token stored hashed that works once for 30 minutes, a new request that voids the old
// link, sessions closed on reset, and throttling.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';

const esbuildPath = globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0] || 'node_modules/esbuild/lib/main.js';
const esbuild = await import(pathToFileURL(esbuildPath));
mkdirSync('.sites-runtime/reset-tests', { recursive: true });
await esbuild.build({
  entryPoints: { password: 'app/api/auth/password/route.ts', records: 'app/api/records/route.ts' },
  outdir: '.sites-runtime/reset-tests', outExtension: { '.js': '.mjs' },
  bundle: true, platform: 'node', format: 'esm', external: ['nodemailer'],
  plugins: [testRuntimePlugin({ auth: true })],
});
const { db, pg } = await createTestDb();
globalThis.testDb = db;
const origin = 'https://localhost'; // devLink is only handed back when AUTH_URL is local
globalThis.testEnv = { AUTH_URL: origin, OWNER_EMAIL: 'contact@the1core.com', OWNER_PASSWORD: 'TOC-owner-test-password' };
const [password, records] = await Promise.all(['password', 'records'].map((n) => import(pathToFileURL(`${process.cwd()}/.sites-runtime/reset-tests/${n}.mjs`))));

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const cookieOf = (response) => response.headers.getSetCookie().find((c) => c.startsWith('__Host-the-one.session='))?.split(';')[0] ?? null;
let address = '198.51.100.1';
async function call(body, { status: expected = 200, headers = {} } = {}) {
  const response = await password.POST(new Request(origin + '/api/auth/password', { method: 'POST', headers: { 'content-type': 'application/json', origin, 'x-vercel-forwarded-for': address, ...headers }, body: JSON.stringify(body) }));
  const data = await response.json();
  assert.equal(response.status, expected, JSON.stringify(data)); checks++;
  return { data, cookie: cookieOf(response) };
}
const api = async (cookie) => records.GET(new Request(origin + '/api/records', { headers: { cookie } }));
const tokenOf = (link) => new URL(link).searchParams.get('reset');

// The owner exists, with two open sessions (two devices).
const phone = await call({ action: 'sign-in', email: 'contact@the1core.com', password: 'TOC-owner-test-password' });
const laptop = await call({ action: 'sign-in', email: 'contact@the1core.com', password: 'TOC-owner-test-password' });

// 1. Same answer for an address with and without an account.
const unknown = await call({ action: 'forgot', email: 'nobody@nowhere.test' });
eq(unknown.data, { ok: true }, 'no account: nothing sent, the usual answer');
const known = await call({ action: 'forgot', email: 'Contact@The1Core.com' });
ok(known.data.ok && known.data.devLink?.startsWith(`${origin}/login?reset=`), 'an account: a link (handed back only without e-mail, outside production)');
await call({ action: 'forgot', email: 'not-an-email' }, { status: 400 });
const token = tokenOf(known.data.devLink);
ok(/^[A-Za-z0-9_-]{43}$/.test(token), 'a 32-byte random token');
ok(!(await pg.query('SELECT token_hash FROM password_resets')).rows.some((r) => r.token_hash === token), 'only its hash is stored');

// 2. A new request voids the previous link.
const again = await call({ action: 'forgot', email: 'contact@the1core.com' });
const token2 = tokenOf(again.data.devLink);
await call({ action: 'reset', token, newPassword: 'new-owner-password-1' }, { status: 400 });
ok(true, 'the older link no longer works');

// 3. The link: a short password is refused, a good one is set, sessions closed, signed in.
await call({ action: 'reset', token: token2, newPassword: 'short' }, { status: 400 });
const done = await call({ action: 'reset', token: token2, newPassword: 'new-owner-password-2' });
ok(!!done.cookie, 'signed in with the new password');
eq([(await api(phone.cookie)).status, (await api(laptop.cookie)).status], [401, 401], 'every other device is signed out');
eq((await api(done.cookie)).status, 200, 'the new session works');
await call({ action: 'sign-in', email: 'contact@the1core.com', password: 'TOC-owner-test-password' }, { status: 401 });
await call({ action: 'sign-in', email: 'contact@the1core.com', password: 'new-owner-password-2' });
ok(true, 'old password refused, new one accepted');
await call({ action: 'reset', token: token2, newPassword: 'new-owner-password-3' }, { status: 400 });
ok(true, 'the link works once');
await call({ action: 'reset', token: 'x'.repeat(43), newPassword: 'whatever-password' }, { status: 400 });
await call({ action: 'reset', token: 'short', newPassword: 'whatever-password' }, { status: 400 });

// 4. A link older than 30 minutes is refused.
address = '198.51.100.2';
const late = await call({ action: 'forgot', email: 'contact@the1core.com' });
await pg.query("UPDATE password_resets SET expires_at = now() - interval '1 minute'");
ok(/expiré/.test((await call({ action: 'reset', token: tokenOf(late.data.devLink), newPassword: 'new-owner-password-4' }, { status: 400 })).data.error), 'expired');

// 5. A member invited with a temporary password can also reset: it ends the temporary state.
const invite = await (await records.POST(new Request(origin + '/api/records', { method: 'POST', headers: { cookie: done.cookie, origin, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'invite-member', email: 'sara@studio.test', name: 'Sara', role: 'creative' }) }))).json();
ok(!!invite.invitation?.temporaryPassword);
address = '198.51.100.3';
const sara = await call({ action: 'forgot', email: 'sara@studio.test' });
await call({ action: 'reset', token: tokenOf(sara.data.devLink), newPassword: 'sara-own-password' });
eq((await call({ action: 'sign-in', email: 'sara@studio.test', password: 'sara-own-password' })).data.mustChangePassword, false, 'no temporary-password step afterwards');

// 6. Throttling: 3 requests per e-mail and 10 per network address, per hour.
address = '198.51.100.4';
for (let i = 0; i < 3; i++) await call({ action: 'forgot', email: 'repeat@nowhere.test' });
await call({ action: 'forgot', email: 'repeat@nowhere.test' }, { status: 429 });
address = '198.51.100.5';
for (let i = 0; i < 10; i++) await call({ action: 'forgot', email: `spray${i}@nowhere.test` });
await call({ action: 'forgot', email: 'spray10@nowhere.test' }, { status: 429 });
await call({ action: 'forgot', email: 'x@y.test' }, { status: 403, headers: { origin: 'https://evil.test' } });

await pg.close();
console.log(`${checks} password-reset checks passed: same answer with or without an account, token hashed and single-use, a new request voids the old link, 30-minute expiry, sessions closed, temporary passwords ended, throttling, same-origin.`);
