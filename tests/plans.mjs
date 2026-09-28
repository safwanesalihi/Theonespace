// Plans (lib/plans.ts, lib/subscription.ts, /api/platform): a company's trial, its limits, read-only after
// its paid period, asking for a plan, and the platform owner recording payments.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';

const esbuildPath = globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0] || 'node_modules/esbuild/lib/main.js';
const esbuild = await import(pathToFileURL(esbuildPath));
mkdirSync('.sites-runtime/plan-tests', { recursive: true });
await esbuild.build({
  entryPoints: { signup: 'app/api/auth/signup/route.ts', password: 'app/api/auth/password/route.ts', records: 'app/api/records/route.ts', assets: 'app/api/assets/route.ts', platform: 'app/api/platform/route.ts', plans: 'lib/plans.ts', subscription: 'lib/subscription.ts' },
  outdir: '.sites-runtime/plan-tests', outExtension: { '.js': '.mjs' },
  bundle: true, platform: 'node', format: 'esm', external: ['nodemailer'],
  plugins: [testRuntimePlugin({ auth: true })],
});
const { db, pg } = await createTestDb();
globalThis.testDb = db;
const origin = 'https://tracker.test';
globalThis.testEnv = { AUTH_URL: origin, OWNER_EMAIL: 'contact@the1core.com', OWNER_PASSWORD: 'TOC-owner-test-password', PUBLIC_SIGNUP: 'on' };
const load = (n) => import(pathToFileURL(`${process.cwd()}/.sites-runtime/plan-tests/${n}.mjs`));
const [signup, password, records, assets, platform, plans, subscription] = await Promise.all(['signup', 'password', 'records', 'assets', 'platform', 'plans', 'subscription'].map(load));

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const cookieOf = (response) => response.headers.getSetCookie().find((c) => c.startsWith('__Host-the-one.session='))?.split(';')[0] ?? null;
let ip = 1;
const auth = async (route, body, expected = 200) => {
  const r = await route.POST(new Request(origin + '/api/auth/x', { method: 'POST', headers: { 'content-type': 'application/json', origin, 'x-vercel-forwarded-for': `198.51.100.${ip++}` }, body: JSON.stringify(body) }));
  const data = await r.json(); assert.equal(r.status, expected, JSON.stringify(data)); checks++; return { data, cookie: cookieOf(r) };
};
const get = async (cookie, ws) => (await records.GET(new Request(origin + '/api/records', { headers: { cookie, ...(ws ? { 'X-Workspace-Id': ws } : {}) } }))).json();
const post = async (cookie, ws, body, expected = 200) => {
  const r = await records.POST(new Request(origin + '/api/records', { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json', 'X-Workspace-Id': ws }, body: JSON.stringify(body) }));
  const data = await r.json(); assert.equal(r.status, expected, JSON.stringify(data)); checks++; return data;
};
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 10, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);
const upload = async (cookie, ws, kind = 'logo') => {
  const form = new FormData(); form.append('kind', kind); form.append('file', new File([png], 'logo.png', { type: 'image/png' }));
  const r = await assets.POST(new Request(origin + '/api/assets', { method: 'POST', headers: { cookie, origin, 'X-Workspace-Id': ws }, body: form }));
  const data = await r.json(); assert.equal(r.status, 200, JSON.stringify(data)); return data.id;
};
const signUp = async (email, company) => {
  const s = await auth(signup, { action: 'start', company, name: 'Owner', email, password: 'company-password-2026' });
  const v = await auth(signup, { action: 'verify', email, code: s.data.devCode });
  return { cookie: v.cookie, ws: v.data.workspaceId };
};
const plat = async (cookie, method, body, expected = 200) => {
  const r = await platform[method](new Request(origin + '/api/platform', method === 'GET' ? { headers: { cookie } } : { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  const data = await r.json(); assert.equal(r.status, expected, JSON.stringify(data)); checks++; return data;
};
const day = 86_400_000;

// 1. The rules, pure: trial, paid period, grace days, suspension, limits.
{
  const now = Date.parse('2026-06-01T00:00:00Z');
  const iso = (d) => new Date(now + d * day).toISOString();
  const st = (sub) => plans.subscriptionState(sub, now);
  eq([st({ plan: 'trial', trialEndsAt: iso(3) }).phase, st({ plan: 'trial', trialEndsAt: iso(3) }).daysLeft, st({ plan: 'trial', trialEndsAt: iso(-1) }).active], ['trial', 3, false], 'a trial runs, then ends');
  eq([st({ plan: 'pro', trialEndsAt: iso(-30), paidUntil: iso(10) }).phase, st({ plan: 'pro', trialEndsAt: iso(-30), paidUntil: iso(-2) }).phase, st({ plan: 'pro', trialEndsAt: iso(-30), paidUntil: iso(-8) }).phase], ['paid', 'grace', 'expired'], 'paid, a week of grace, then expired');
  eq(st({ plan: 'pro', trialEndsAt: iso(-30), paidUntil: iso(100), canceled: true }).active, false, 'suspended stops at once');
  eq(st({ plan: 'agency', trialEndsAt: iso(-30), paidUntil: iso(5) }).limits, plans.plans.agency.limits, 'the plan’s limits');
  const usage = { members: 3, clients: 4, storageMb: 10, aiThisMonth: 50 };
  eq([plans.overLimit(plans.plans.trial.limits, usage, 'members'), plans.overLimit(plans.plans.trial.limits, usage, 'clients'), plans.overLimit(plans.plans.trial.limits, usage, 'aiPerMonth')], ['members', null, 'aiPerMonth'], 'limits counted');
  eq(plans.extendPaid({ plan: 'pro', trialEndsAt: iso(0), paidUntil: iso(10) }, 1, now).slice(0, 10), '2026-07-11', 'more months add to a running period');
  eq(plans.extendPaid({ plan: 'pro', trialEndsAt: iso(0), paidUntil: iso(-10) }, 1, now).slice(0, 10), '2026-07-01', 'a lapsed one starts again today');
}

// 2. Sign-up starts a 14-day trial; the owner sees plan and usage, members only the state.
const co = await signUp('owner@plan.test', 'Plan Co');
let data = await get(co.cookie);
eq([data.plan.subscription.plan, data.plan.state.phase, data.plan.state.daysLeft, data.plan.usage.members], ['trial', 'trial', 14, 1], '14-day trial, the owner counted as a seat');
const studioOwner = (await auth(password, { action: 'sign-in', email: 'contact@the1core.com', password: 'TOC-owner-test-password' })).cookie;
eq((await get(studioOwner)).plan, undefined, 'The One Core’s own workspace has no plan');

// 3. Limits: 3 seats and 5 clients in the trial; client contacts don't take a seat.
await post(co.cookie, co.ws, { action: 'invite-member', email: 'a@plan.test', name: 'A', role: 'creative' });
await post(co.cookie, co.ws, { action: 'invite-member', email: 'b@plan.test', name: 'B', role: 'admin' });
const refused = await post(co.cookie, co.ws, { action: 'invite-member', email: 'c@plan.test', name: 'C', role: 'creative' }, 403);
eq(refused.code, 'plan-limit', 'the fourth seat is refused');
const clientIds = [];
for (let i = 0; i < 5; i++) clientIds.push((await post(co.cookie, co.ws, { action: 'create', kind: 'client', data: { name: `Client ${i}` } })).id);
eq((await post(co.cookie, co.ws, { action: 'create', kind: 'client', data: { name: 'Client 6' } }, 403)).code, 'plan-limit', 'the sixth client is refused');
await post(co.cookie, co.ws, { action: 'invite-member', email: 'contact@client.test', name: 'Contact', role: 'client', clientId: clientIds[0] });
ok(true, 'a client contact does not take a seat');
data = await get(co.cookie);
eq([data.plan.usage.members, data.plan.usage.clients], [3, 5], 'usage counted');

// 4. Asking for a plan: the owner only.
await post(co.cookie, co.ws, { action: 'request-plan', plan: 'enterprise' }, 400);
await post(co.cookie, co.ws, { action: 'request-plan', plan: 'pro' });
eq((await get(co.cookie)).plan.subscription.requestedPlan, 'pro', 'the request is recorded');

// 5. Plateforme: the platform owner only, everyone else gets a 404.
await plat(co.cookie, 'GET', null, 404);
await plat(co.cookie, 'POST', { action: 'mark-paid', workspaceId: co.ws, plan: 'pro', months: 1 }, 404);
let list = (await plat(studioOwner, 'GET')).companies;
const row = list.find((c) => c.id === co.ws);
eq([row.name, row.ownerEmail, row.subscription.requestedPlan, row.usage.clients], ['Plan Co', 'owner@plan.test', 'pro', 5], 'the company, its owner, request and usage');
await plat(studioOwner, 'POST', { action: 'mark-paid', workspaceId: 'ws:someone', plan: 'pro', months: 1 }, 400);
await plat(studioOwner, 'POST', { action: 'mark-paid', workspaceId: co.ws, plan: 'gold', months: 1 }, 400);
await plat(studioOwner, 'POST', { action: 'mark-paid', workspaceId: co.ws, plan: 'pro', months: 0 }, 400);
list = (await plat(studioOwner, 'POST', { action: 'mark-paid', workspaceId: co.ws, plan: 'pro', months: 1 })).companies;
const paid = list.find((c) => c.id === co.ws);
eq([paid.subscription.plan, paid.state.phase, paid.subscription.requestedPlan], ['pro', 'paid', null], 'marked paid on Pro, the request cleared');
ok(paid.state.daysLeft >= 28 && paid.state.daysLeft <= 31, 'a month paid');
await post(co.cookie, co.ws, { action: 'create', kind: 'client', data: { name: 'Client 6' } });
await post(co.cookie, co.ws, { action: 'invite-member', email: 'c@plan.test', name: 'C', role: 'creative' });
ok(true, 'Pro lifts the limits');

// 6. Lapsed: read-only everywhere (records, uploads), but the owner can still ask for a plan.
await db.query("UPDATE subscriptions SET paid_until = now() - interval '8 days' WHERE workspace_id = $1", [co.ws]);
data = await get(co.cookie);
eq([data.plan.state.phase, data.records.filter((r) => r.kind === 'client').length], ['expired', 6], 'expired, and everything still readable');
eq((await post(co.cookie, co.ws, { action: 'create', kind: 'client', data: { name: 'Late' } }, 402)).code, 'plan-inactive', 'no more changes');
await post(co.cookie, co.ws, { action: 'set-brand', color: '#3a7bd5' }, 402);
const form = new FormData(); form.append('kind', 'logo'); form.append('file', new File([png], 'l.png', { type: 'image/png' }));
eq((await assets.POST(new Request(origin + '/api/assets', { method: 'POST', headers: { cookie: co.cookie, origin, 'X-Workspace-Id': co.ws }, body: form }))).status, 402, 'no uploads either');
checks++;
await post(co.cookie, co.ws, { action: 'request-plan', plan: 'starter' });
ok(true, 'asking for a plan still works');
// a member sees the state (for the banner) but not the usage
const aInvite = await db.query("SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND email = 'a@plan.test'", [co.ws]);
ok(aInvite.length === 1, 'member present');

// 7. Grace: 2 days after the paid period the workspace still works.
await db.query("UPDATE subscriptions SET paid_until = now() - interval '2 days' WHERE workspace_id = $1", [co.ws]);
eq((await get(co.cookie)).plan.state.phase, 'grace', 'grace days');
await post(co.cookie, co.ws, { action: 'create', kind: 'client', data: { name: 'Grace client' } });

// 8. Suspend and reactivate; a trial ended; a trial extended.
await plat(studioOwner, 'POST', { action: 'suspend', workspaceId: co.ws });
eq((await post(co.cookie, co.ws, { action: 'create', kind: 'client', data: { name: 'x' } }, 402)).error.includes('suspendu'), true, 'suspended');
await plat(studioOwner, 'POST', { action: 'reactivate', workspaceId: co.ws });
const other = await signUp('owner@trial.test', 'Trial Co');
await db.query("UPDATE subscriptions SET trial_ends_at = now() - interval '1 day' WHERE workspace_id = $1", [other.ws]);
eq((await post(other.cookie, other.ws, { action: 'create', kind: 'client', data: { name: 'x' } }, 402)).error.includes('essai'), true, 'the trial ended');
await plat(studioOwner, 'POST', { action: 'extend-trial', workspaceId: other.ws, days: 7 });
eq((await get(other.cookie)).plan.state.daysLeft, 7, 'seven more days');
await post(other.cookie, other.ws, { action: 'create', kind: 'client', data: { name: 'x' } });

// 9. AI requests counted per month against the plan.
for (let i = 0; i < 50; i++) await subscription.countAiCall(other.ws);
eq((await subscription.planRefusal(other.ws, 'aiPerMonth'))?.code, 'plan-limit', '50 AI requests use up the trial');
eq(await subscription.planRefusal('ws:studio', 'aiPerMonth'), null, 'The One Core is never limited');

await pg.close();
console.log(`${checks} plan checks passed: trial, paid period, grace, suspension, seat/client/storage/AI limits, client contacts free, read-only after the period (records and uploads), plan requests, the Plateforme page for the platform owner only.`);
