// Public sign-up (lib/signup.ts, /api/auth/signup): off by default; the e-mailed code; a company gets
// its own workspace with its own name and is sealed off from every other one; an address that is
// already registered is neither revealed nor taken over; nobody can claim an address before its owner
// is invited; wrong and expired codes; throttling; the studio's owner keeps what is theirs alone.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';

const esbuildPath = globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0] || 'node_modules/esbuild/lib/main.js';
const esbuild = await import(pathToFileURL(esbuildPath));
mkdirSync('.sites-runtime/signup-tests', { recursive: true });
await esbuild.build({
  entryPoints: { signup: 'app/api/auth/signup/route.ts', password: 'app/api/auth/password/route.ts', records: 'app/api/records/route.ts', status: 'app/api/auth/status/route.ts' },
  outdir: '.sites-runtime/signup-tests', outExtension: { '.js': '.mjs' },
  bundle: true, platform: 'node', format: 'esm', external: ['nodemailer'],
  plugins: [testRuntimePlugin({ auth: true })],
});
const { db, pg } = await createTestDb();
globalThis.testDb = db;
const origin = 'https://localhost'; // dev codes are only handed back when AUTH_URL is local
const env = { AUTH_URL: origin, OWNER_EMAIL: 'contact@the1core.com', OWNER_PASSWORD: 'TOC-owner-test-password' };
globalThis.testEnv = env;
const load = (name) => import(pathToFileURL(`${process.cwd()}/.sites-runtime/signup-tests/${name}.mjs`));
const [signup, password, records, status] = await Promise.all(['signup', 'password', 'records', 'status'].map(load));

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const cookieOf = (response) => response.headers.getSetCookie().find((c) => c.startsWith('__Host-the-one.session='))?.split(';')[0] ?? null;
let address = '198.51.100.1';
async function call(route, body, { status: expected = 200, headers = {} } = {}) {
  const response = await route.POST(new Request(origin + '/api/auth/x', { method: 'POST', headers: { 'content-type': 'application/json', origin, 'x-vercel-forwarded-for': address, ...headers }, body: JSON.stringify(body) }));
  const data = await response.json();
  assert.equal(response.status, expected, JSON.stringify(data)); checks++;
  return { data, cookie: cookieOf(response) };
}
const chosen = new Map(); // the password each address started with: the verify step sends it back
const start = (data, opts) => { const body = { action: 'start', company: 'Atlas Studio', name: 'Sara Atlas', password: 'atlas-password-2026', ...data }; chosen.set(body.email, body.password); return call(signup, body, opts); };
const verify = (email, code, opts, pw = chosen.get(email)) => call(signup, { action: 'verify', email, code, password: pw }, opts);
const api = async (cookie, ws) => (await records.GET(new Request(origin + '/api/records', { headers: { cookie, ...(ws ? { 'X-Workspace-Id': ws } : {}) } })));
const mutate = async (cookie, ws, body) => records.POST(new Request(origin + '/api/records', { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json', 'X-Workspace-Id': ws }, body: JSON.stringify(body) }));
const signIn = (email, pw) => call(password, { action: 'sign-in', email, password: pw });

// 1. Off by default: no link on the sign-in page, and the endpoint doesn't exist.
eq((await status.GET().json()).signupEnabled, false, 'the sign-in page offers no sign-up');
await start({ email: 'sara@atlas.test' }, { status: 404 });
eq((await pg.query('SELECT count(*)::int AS n FROM users')).rows[0].n, 0, 'nothing written');

env.PUBLIC_SIGNUP = 'on';
eq((await status.GET().json()).signupEnabled, true, 'switched on: the link appears');

// 2. What the form must hold.
await start({ email: 'not-an-email' }, { status: 400 });
await start({ email: 'sara@atlas.test', password: 'short' }, { status: 400 });
await start({ email: 'sara@atlas.test', company: ' ' }, { status: 400 });
await start({ email: 'sara@atlas.test', name: '' }, { status: 400 });
await start({ email: 'sara@atlas.test' }, { status: 403, headers: { origin: 'https://evil.test' } });

// 3. The code: a wrong one counts down, the right one creates the account, its workspace, a session.
const first = await start({ email: 'Sara@Atlas.test' });
ok(/^\d{6}$/.test(first.data.devCode), 'a 6-digit code (handed back only without e-mail, outside production)');
eq((await pg.query('SELECT count(*)::int AS n FROM users')).rows[0].n, 0, 'no account before the code');
const pending = (await pg.query("SELECT password_hash, code_hash FROM signup_requests WHERE email = 'sara@atlas.test'")).rows[0];
ok(pending.password_hash.startsWith('scrypt$') && !pending.code_hash.includes(first.data.devCode), 'password hashed, code not stored in the clear');
const wrong = first.data.devCode === '000000' ? '111111' : '000000';
ok(/4 essais restants/.test((await verify('sara@atlas.test', wrong, { status: 400 })).data.error), 'a wrong code says how many tries are left');
const sara = await verify('sara@atlas.test', first.data.devCode);
ok(!!sara.cookie, 'signed in right away');
ok(sara.data.workspaceId.startsWith('ws:org:'), 'a company workspace');
const atlas = await (await api(sara.cookie)).json();
eq([atlas.workspace.id, atlas.workspace.name, atlas.workspace.role, atlas.platformOwner], [sara.data.workspaceId, 'Atlas Studio', 'owner', false], 'its own name, its owner, not the studio’s owner');
eq(atlas.workspaces.map((w) => w.id), [sara.data.workspaceId], 'the only workspace offered');
eq((await pg.query("SELECT count(*)::int AS n FROM signup_requests WHERE email = 'sara@atlas.test'")).rows[0].n, 0, 'the request is gone');
await verify('sara@atlas.test', first.data.devCode, { status: 400 });
ok(true, 'the code works once');
await signIn('sara@atlas.test', 'atlas-password-2026');
ok(true, 'the chosen password signs in afterwards');

// 4. The company runs its own workspace: clients, an invited member.
const A = sara.data.workspaceId;
const client = await (await mutate(sara.cookie, A, { action: 'create', kind: 'client', data: { name: 'Client Atlas' } })).json();
ok(!!client.id, 'the owner creates a client');
const invite = await (await mutate(sara.cookie, A, { action: 'invite-member', email: 'yanis@atlas.test', name: 'Yanis', role: 'creative' })).json();
ok(!!invite.invitation?.temporaryPassword, 'and invites a member');
const yanis = await signIn('yanis@atlas.test', invite.invitation.temporaryPassword);
await call(password, { action: 'change-password', currentPassword: invite.invitation.temporaryPassword, newPassword: 'yanis-password-2026' }, { headers: { cookie: yanis.cookie } });
const yanisView = await (await api(yanis.cookie)).json();
eq([yanisView.workspace.id, yanisView.workspace.role], [A, 'creative'], 'the member lands in the company’s workspace');
const printAttempt = await mutate(sara.cookie, A, { action: 'create-print-workspace' });
eq(printAttempt.status, 403, 'the print workspace stays the studio’s own');

// 5. A second company is sealed off from the first.
address = '198.51.100.2';
const second = await start({ email: 'omar@nova.test', company: 'Nova Media', name: 'Omar Nova', password: 'nova-password-2026' });
const omar = await verify('omar@nova.test', second.data.devCode);
const nova = await (await api(omar.cookie)).json();
eq([nova.workspace.name, nova.records.filter((r) => r.kind === 'client').length], ['Nova Media', 0], 'its own empty workspace');
eq((await api(omar.cookie, A)).status, 403, 'another company’s workspace is refused');
eq((await mutate(omar.cookie, A, { action: 'create', kind: 'client', data: { name: 'intrus' } })).status, 403, 'and cannot be written to');
eq((await api(sara.cookie, omar.cookie && nova.workspace.id)).status, 403, 'both ways');

// 6. The studio's owner keeps their workspace, under its name, and what is theirs alone.
const studioOwner = await signIn('contact@the1core.com', 'TOC-owner-test-password');
const studio = await (await api(studioOwner.cookie)).json();
eq([studio.workspace.name, studio.platformOwner], ['The One Space', true], 'the studio as before');
ok(!studio.workspaces.some((w) => w.id === A || w.id === nova.workspace.id), 'companies’ workspaces are not the studio’s');

// 7. An address that already has an account: the same answer, no code, no takeover.
address = '198.51.100.3';
const taken = await start({ email: 'contact@the1core.com', company: 'Fake', name: 'Fake' });
eq(Object.keys(taken.data), ['ok'], 'exactly the answer a new address gets, minus the code it would never see');
await verify('contact@the1core.com', '123456', { status: 400 });
const taken2 = await start({ email: 'sara@atlas.test', company: 'Other', name: 'Other' });
eq(Object.keys(taken2.data), ['ok']);
await signIn('sara@atlas.test', 'atlas-password-2026');
ok(true, 'the existing password is untouched');

// 8. Nobody can claim an address before its owner is invited.
address = '203.0.113.9';
const claim = await start({ email: 'lina@future.test', company: 'Trap', name: 'Attacker', password: 'attacker-password-1' });
const studioInvite = await (await mutate(studioOwner.cookie, studio.workspace.id, { action: 'invite-member', email: 'lina@future.test', name: 'Lina', role: 'admin' })).json();
ok(!!studioInvite.invitation?.temporaryPassword, 'the studio invites the real person: a fresh account, not the pending one');
ok((await verify('lina@future.test', claim.data.devCode, { status: 409 })).data.error.includes('existe déjà'), 'the pending claim can no longer become an account');
await signIn('lina@future.test', 'attacker-password-1').catch(() => {});
eq((await password.POST(new Request(origin + '/api/auth/password', { method: 'POST', headers: { 'content-type': 'application/json', origin, 'x-vercel-forwarded-for': '203.0.113.10' }, body: JSON.stringify({ action: 'sign-in', email: 'lina@future.test', password: 'attacker-password-1' }) }))).status, 401, 'the attacker’s password opens nothing');

// 8b. The code is bound to the password chosen at the start: a re-start with another password can't ride on the owner's code.
await start({ email: 'bind@test.test', password: 'victim-password-1' });
address = '203.0.113.11';
const overwrite = await start({ email: 'bind@test.test', password: 'attacker-password-2' });
ok(/pas celui/.test((await verify('bind@test.test', overwrite.data.devCode, { status: 400 }, 'victim-password-1')).data.error), 'the owner\'s password does not match the overwritten request');

// 9. Five wrong codes, or 30 minutes, and the request is gone.
address = '198.51.100.4';
const brute = await start({ email: 'brute@test.test' });
for (let i = 0; i < 5; i++) await verify('brute@test.test', String(100000 + i === Number(brute.data.devCode) ? 999999 : 100000 + i), { status: 400 });
await verify('brute@test.test', brute.data.devCode, { status: 400 });
ok(true, 'after five wrong codes even the right one is refused');
const late = await start({ email: 'late@test.test' });
await pg.query("UPDATE signup_requests SET expires_at = now() - interval '1 minute' WHERE email = 'late@test.test'");
ok(/expiré/.test((await verify('late@test.test', late.data.devCode, { status: 400 })).data.error), 'an expired code is refused');

// 10. Throttling: 3 requests per address e-mail and 10 per network address, per hour.
address = '198.51.100.5';
for (let i = 0; i < 3; i++) await start({ email: 'again@test.test' });
await start({ email: 'again@test.test' }, { status: 429 });
address = '198.51.100.6';
for (let i = 0; i < 10; i++) await start({ email: `spam${i}@test.test` });
await start({ email: 'spam10@test.test' }, { status: 429 });

// 11. Switched off again: nothing more comes in, existing companies keep working.
env.PUBLIC_SIGNUP = '';
address = '198.51.100.7';
await start({ email: 'closed@test.test' }, { status: 404 });
eq((await api(sara.cookie)).status, 200, 'companies already created keep their workspace');

await pg.close();
console.log(`${checks} sign-up checks passed: off by default, form rules, e-mailed code (once, hashed), company workspace with its own name and owner, members, print kept for the studio, companies sealed off, the studio untouched, existing addresses neither revealed nor taken over, no claiming an address before its invitation, wrong and expired codes, throttling, switching off.`);
