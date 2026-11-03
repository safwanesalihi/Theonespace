// « Demander un accès » (lib/access-requests.ts, /api/auth/access-request, Plateforme → Demandes): an agency
// asks, the same address asking again only updates its request, the form is throttled, only the platform
// owner sees and decides, and opening a space creates the account (no usable password), the workspace with
// its owner, the chosen plan, the studio's process and a link that sets the password and signs in.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';

const esbuildPath = globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0] || 'node_modules/esbuild/lib/main.js';
const esbuild = await import(pathToFileURL(esbuildPath));
mkdirSync('.sites-runtime/access-request-tests', { recursive: true });
await esbuild.build({
  entryPoints: { password: 'app/api/auth/password/route.ts', ask: 'app/api/auth/access-request/route.ts', platform: 'app/api/platform/route.ts' },
  outdir: '.sites-runtime/access-request-tests', outExtension: { '.js': '.mjs' },
  bundle: true, platform: 'node', format: 'esm', external: ['nodemailer'],
  plugins: [testRuntimePlugin({ auth: true })],
});
const { db, pg } = await createTestDb();
globalThis.testDb = db;
const origin = 'https://localhost'; // the first-access link is handed back only when AUTH_URL is local and no mail is set up
globalThis.testEnv = { AUTH_URL: origin, OWNER_EMAIL: 'contact@the1core.com', OWNER_PASSWORD: 'TOC-owner-test-password' };
const load = (n) => import(pathToFileURL(`${process.cwd()}/.sites-runtime/access-request-tests/${n}.mjs`));
const [password, ask, platform] = await Promise.all(['password', 'ask', 'platform'].map(load));

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const cookieOf = (r) => r.headers.getSetCookie().find((c) => c.startsWith('__Host-the-one.session='))?.split(';')[0] ?? null;
let address = '198.51.100.10';
const post = async (route, body, { expected = 200, headers = {} } = {}) => {
  const r = await route.POST(new Request(origin + '/api/x', { method: 'POST', headers: { 'content-type': 'application/json', origin, 'x-vercel-forwarded-for': address, ...headers }, body: JSON.stringify(body) }));
  const data = await r.json(); assert.equal(r.status, expected, JSON.stringify(data)); checks++;
  return { data, cookie: cookieOf(r) };
};
const call = async (cookie, query, body, expected = 200) => {
  const r = body
    ? await platform.POST(new Request(origin + '/api/platform', { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json' }, body: JSON.stringify(body) }))
    : await platform.GET(new Request(`${origin}/api/platform${query}`, { headers: { cookie } }));
  const data = await r.json(); assert.equal(r.status, expected, JSON.stringify(data)); checks++; return data;
};
const request = (change = {}) => ({ company: 'Atlas Studio', name: 'Salma Idrissi', email: 'salma@atlas.test', phone: '+212 6 12 34 56 78', city: 'Rabat', teamSize: '2-5', studioType: '', message: 'Six clients, tout sur WhatsApp.', ...change });

// 1. The public form: validated, same-origin, kept; the same address asking again only updates it.
eq((await post(ask, request())).data, { ok: true }, 'a request is received');
await post(ask, request({ company: 'A' }), { expected: 400 });
await post(ask, request({ email: 'not-an-email' }), { expected: 400 });
await post(ask, request({ phone: 'call me' }), { expected: 400 });
await post(ask, request({ teamSize: '1000' }), { expected: 400 });
await post(ask, request(), { expected: 403, headers: { origin: 'https://evil.test' } });
await post(ask, request({ company: 'Atlas Studio SARL', email: 'SALMA@atlas.test' }));
let rows = (await pg.query('SELECT company, email, status FROM access_requests')).rows;
eq(rows, [{ company: 'Atlas Studio SARL', email: 'salma@atlas.test', status: 'pending' }], 'one waiting request per address, updated');

// 2. Throttled: 3 per e-mail and 5 per network address, per hour.
await post(ask, request()); // the latest wording wins
await post(ask, request(), { expected: 429 });
address = '198.51.100.11';
for (let i = 0; i < 5; i++) await post(ask, request({ email: `agency${i}@spam.test`, company: `Agence ${i}` }));
await post(ask, request({ email: 'agency9@spam.test' }), { expected: 429 });

// 3. Only the platform owner sees and decides.
const owner = (await post(password, { action: 'sign-in', email: 'contact@the1core.com', password: 'TOC-owner-test-password' })).cookie;
ok(!!owner, 'the platform owner is signed in');
const list = (await call(owner, '?requests')).requests;
eq(list.length, 6, 'every request');
const atlas = list.find((r) => r.email === 'salma@atlas.test');
eq([atlas.status, atlas.phone, atlas.city, atlas.teamSize], ['pending', '+212 6 12 34 56 78', 'Rabat', '2-5'], 'with what the agency told us');
await call(null, '?requests', null, 404);
ok(true, 'hidden from anyone else');

// 4. Decline: kept on file, marked declined, logged, and cannot be decided twice.
const spam = list.find((r) => r.email === 'agency0@spam.test');
const afterDecline = (await call(owner, null, { action: 'request-decline', requestId: spam.id })).requests;
eq(afterDecline.find((r) => r.id === spam.id).status, 'declined', 'declined, still listed');
await call(owner, null, { action: 'request-approve', requestId: spam.id, plan: 'trial', days: 14 }, 409);
await call(owner, null, { action: 'request-approve', requestId: 99999, plan: 'trial', days: 14 }, 404);
await call(owner, null, { action: 'request-approve', requestId: atlas.id, plan: 'trial', days: 500 }, 400);
await call(owner, null, { action: 'request-approve', requestId: atlas.id, plan: 'gold', months: 1 }, 400);

// 5. Open the space on a paid plan: account, workspace, owner, plan, and a first-access link.
const opened = await call(owner, null, { action: 'request-approve', requestId: atlas.id, plan: 'pro', months: 3 });
eq(opened.requests.find((r) => r.id === atlas.id).status, 'approved', 'the request is approved');
const company = opened.companies.find((c) => c.name === 'Atlas Studio');
ok(company && company.ownerEmail === 'salma@atlas.test', 'the company is listed, the person who asked as owner');
eq([company.subscription.plan, company.state.phase], ['pro', 'paid'], 'on the plan agreed');
ok(Date.parse(company.subscription.paidUntil) - Date.now() > 85 * 86_400_000, 'paid for about three months');
eq(opened.opened.mailed, false, 'no mail set up in this test');
ok(opened.opened.devLink?.startsWith(`${origin}/login?reset=`), 'the link is handed back in local development');
const member = (await pg.query('SELECT role FROM workspace_members WHERE workspace_id = $1', [company.id])).rows;
eq(member, [{ role: 'owner' }], 'one member: the owner');
await post(password, { action: 'sign-in', email: 'salma@atlas.test', password: 'anything-at-all-1' }, { expected: 401 });
ok(true, 'nobody can sign in before choosing a password');
const expires = (await pg.query('SELECT expires_at FROM password_resets')).rows[0].expires_at;
ok(new Date(expires).getTime() - Date.now() > 6 * 86_400_000, 'the link lasts a week, not 30 minutes');

// 6. The link sets the password and signs the agency in; it works once.
const token = new URL(opened.opened.devLink).searchParams.get('reset');
const first = await post(password, { action: 'reset', token, newPassword: 'atlas-studio-2026' });
ok(!!first.cookie, 'signed in on first use');
await post(password, { action: 'sign-in', email: 'salma@atlas.test', password: 'atlas-studio-2026' });
await post(password, { action: 'reset', token, newPassword: 'atlas-studio-2027' }, { expected: 400 });
await call(owner, null, { action: 'request-approve', requestId: atlas.id, plan: 'trial', days: 14 }, 409);

// 7. A trial with the studio's process; an address that already has an account is refused.
const studio = list.find((r) => r.email === 'agency1@spam.test');
await pg.query("UPDATE access_requests SET studio_type = 'social' WHERE id = $1", [studio.id]);
const trial = await call(owner, null, { action: 'request-approve', requestId: studio.id, plan: 'trial', days: 30 });
const trialCompany = trial.companies.find((c) => c.name === 'Agence 1');
eq(trialCompany.state.phase, 'trial', 'a trial');
ok((await pg.query("SELECT 1 FROM records WHERE workspace_id = $1 AND kind = 'meta'", [trialCompany.id])).rows.length === 1, 'starting from its studio’s process');
ok(Math.abs(Date.parse(trialCompany.subscription.trialEndsAt) - Date.now() - 30 * 86_400_000) < 60_000, 'of the 30 days chosen');
address = '198.51.100.12';
await pg.query('DELETE FROM login_throttle'); // an hour later
await post(ask, request({ company: 'Atlas encore' }));
const again = (await call(owner, '?requests')).requests.find((r) => r.status === 'pending' && r.email === 'salma@atlas.test');
ok(/déjà un compte/.test((await call(owner, null, { action: 'request-approve', requestId: again.id, plan: 'trial', days: 14 }, 409)).error), 'an existing account is not opened twice');
rows = (await pg.query("SELECT count(*)::int AS n FROM users WHERE email = 'salma@atlas.test'")).rows;
eq(rows[0].n, 1, 'still one account');

// 8. The journal records both decisions.
const log = (await call(owner, '?audit')).actions.map((e) => e.action);
ok(log.includes('request-approve') && log.includes('request-decline'), 'both decisions are logged');

await pg.close();
console.log(`${checks} access request checks passed: the public form (validated, same-origin, one waiting request per address, throttled), owner only, decline, open on a paid plan or a trial, a week-long first-access link that signs in once, no second account, and the journal.`);
