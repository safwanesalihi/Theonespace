// The Plateforme console (lib/platform-metrics.ts, lib/site-content.ts, lib/platform-audit.ts, /api/platform,
// /api/site): revenue, service cost and margin per company and overall, what needs the owner, the public
// site's key information (validated, owner only, served to everyone) and the log of every change.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';

const esbuildPath = globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0] || 'node_modules/esbuild/lib/main.js';
const esbuild = await import(pathToFileURL(esbuildPath));
mkdirSync('.sites-runtime/platform-console-tests', { recursive: true });
await esbuild.build({
  entryPoints: { health: 'lib/platform-health.ts', password: 'app/api/auth/password/route.ts', signup: 'app/api/auth/signup/route.ts', platform: 'app/api/platform/route.ts', site: 'app/api/site/route.ts', metrics: 'lib/platform-metrics.ts', content: 'lib/site-content.ts', plans: 'lib/plans.ts' },
  outdir: '.sites-runtime/platform-console-tests', outExtension: { '.js': '.mjs' },
  bundle: true, platform: 'node', format: 'esm', external: ['nodemailer'],
  plugins: [testRuntimePlugin({ auth: true })],
});
const { db, pg } = await createTestDb();
globalThis.testDb = db;
const origin = 'https://localhost';
globalThis.testEnv = { AUTH_URL: origin, OWNER_EMAIL: 'contact@the1core.com', OWNER_PASSWORD: 'TOC-owner-test-password', PUBLIC_SIGNUP: 'on' };
const load = (n) => import(pathToFileURL(`${process.cwd()}/.sites-runtime/platform-console-tests/${n}.mjs`));
const healthLib = await load('health');
const [password, signup, platform, site, metrics, content, plans] = await Promise.all(['password', 'signup', 'platform', 'site', 'metrics', 'content', 'plans'].map(load));

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

// 1. Cost, revenue, cost level and the overview, on companies built by hand.
const now = Date.parse('2026-11-02T12:00:00Z');
const dayMs = 86_400_000;
const iso = (days) => new Date(now + days * dayMs).toISOString();
const usage = (u = {}) => ({ members: 1, clients: 1, storageMb: 0, aiThisMonth: 0, igThisMonth: 0, meetingMinutesThisMonth: 0, whatsappThisMonth: 0, ...u });
const company = (id, sub, u, created = -30) => {
  const subscription = { trialEndsAt: iso(created + 14), ...sub };
  return { id, name: id, createdAt: iso(created), subscription, state: plans.subscriptionState(subscription, now), usage: usage(u) };
};
eq(metrics.serviceCost(usage({ whatsappThisMonth: 100, meetingMinutesThisMonth: 1000, igThisMonth: 10, aiThisMonth: 100 })),
  { whatsapp: 23, calls: 40, instagram: 11.5, ai: 1, total: 75.5 }, 'each meter at its unit cost, in MAD');
const paid = company('paid', { plan: 'pro', paidUntil: iso(20) }, { whatsappThisMonth: 400 }, -100);
const late = company('late', { plan: 'agency', paidUntil: iso(-3) }, { whatsappThisMonth: 5000, meetingMinutesThisMonth: 6000 }, -140);
const trial = company('trial', { plan: 'trial', trialEndsAt: iso(2), requestedPlan: 'starter' }, { whatsappThisMonth: 50 }, -12);
const over = company('over', { plan: 'trial', trialEndsAt: iso(-5) }, {}, -19);
eq([metrics.monthlyRevenue(paid), metrics.monthlyRevenue(late), metrics.monthlyRevenue(trial), metrics.monthlyRevenue(over)], [699, 1499, 0, 0], 'a paid plan pays, grace included; a trial or a stopped company does not');
eq([metrics.costLevel(paid), metrics.costLevel(late), metrics.costLevel(trial)], ['ok', 'high', 'ok'], '92 MAD on 699 is fine, 1,390 MAD on 1,499 is too much');
const o = metrics.platformOverview([paid, late, trial, over], now);
eq([o.companies, o.paying, o.trials, o.stopped, o.requests], [4, 2, 1, 1, 1], 'the companies by state');
eq([o.mrr, o.arr], [2198, 26376], 'revenue per month and per year');
eq([o.serviceCost, o.margin], [1493.5, 704.5], 'what the services cost and what is left');
eq(o.planMix, { trial: 1, starter: 0, pro: 1, agency: 1 }, 'the active plans');
eq(o.signups.length, 8, 'eight weeks of sign-ups');
eq(o.signups.reduce((s, w) => s + w.count, 0), 2, 'the two companies of the last eight weeks');
eq(o.attention.map((a) => `${a.kind}:${a.id}`), ['request:trial', 'grace:late', 'trial-ending:trial', 'cost:late'], 'what needs the owner, most pressing first');

// 2. The site's key information: defaults, merging, validation.
const base = content.defaultSiteContent;
eq(content.readSiteContent(null), base, 'nothing stored: the defaults');
eq(content.readSiteContent({ contact: { city: 'Rabat' } }).contact.city, 'Rabat', 'a stored value wins');
eq(content.readSiteContent({ contact: { city: 'Rabat' } }).pilot, base.pilot, 'the other groups keep their defaults');
const with_ = (group, change) => ({ ...base, [group]: { ...base[group], ...change } });
ok(content.siteContentSchema.safeParse(base).success, 'the defaults are valid');
for (const [why, value, path] of [
  ['a banner switched on needs a text', with_('announcement', { on: true, text: '' }), 'announcement.text'],
  ['a link needs a label', with_('announcement', { link: '#pilote', linkLabel: '' }), 'announcement.linkLabel'],
  ['no javascript: link', with_('social', { instagram: 'javascript:alert(1)' }), 'social.instagram'],
  ['no http:// link', with_('announcement', { on: true, text: 'x', link: 'http://evil.test', linkLabel: 'x' }), 'announcement.link'],
  ['a pilot offer switched on needs a title', with_('pilot', { title: '' }), 'pilot.title'],
  ['a real date', with_('pilot', { deadline: '30/11/2026' }), 'pilot.deadline'],
  ['a whole number of seats', with_('pilot', { seatsLeft: 1000 }), 'pilot.seatsLeft'],
  ['no unknown field', { ...base, script: '<script>' }, ''],
]) {
  const r = content.siteContentSchema.safeParse(value);
  ok(!r.success && r.error.issues[0].path.join('.') === path, why);
}

// 3. The API: owner only, saved, logged, served to everyone.
let ip = 1;
const authPost = async (route, body) => {
  const r = await route.POST(new Request(origin + '/api/auth/x', { method: 'POST', headers: { 'content-type': 'application/json', origin, 'x-vercel-forwarded-for': `198.51.100.${ip++}` }, body: JSON.stringify(body) }));
  return { data: await r.json(), cookie: r.headers.getSetCookie().find((c) => c.startsWith('__Host-the-one.session='))?.split(';')[0] };
};
const owner = (await authPost(password, { action: 'sign-in', email: 'contact@the1core.com', password: 'TOC-owner-test-password' })).cookie;
const started = await authPost(signup, { action: 'start', company: 'Agence Test', name: 'Owner', email: 'owner@console.test', password: 'company-password-2026' });
const s = (await authPost(signup, { action: 'verify', email: 'owner@console.test', code: started.data.devCode, password: 'company-password-2026' })).cookie;
ok(owner && s, 'the platform owner and a company owner are signed in');
const call = async (cookie, query, body, expected = 200) => {
  const r = body
    ? await platform.POST(new Request(origin + '/api/platform', { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json' }, body: JSON.stringify(body) }))
    : await platform.GET(new Request(`${origin}/api/platform${query}`, { headers: { cookie } }));
  const data = await r.json(); assert.equal(r.status, expected, JSON.stringify(data)); checks++; return data;
};
const publicSite = async () => { const r = await site.GET(new Request(origin + '/api/site')); return { cache: r.headers.get('cache-control'), ...(await r.json()) }; };

eq((await call(owner, '?site')).site, { content: base, updatedAt: null, updatedBy: null }, 'nothing saved yet: the defaults');
await call(s, '?site', null, 404);
await call(s, null, { action: 'site-save', content: base }, 404);
const changed = with_('announcement', { on: true, text: 'Les inscriptions pilotes ferment le 30 novembre.', link: '#pilote', linkLabel: 'Postuler' });
const bad = await call(owner, null, { action: 'site-save', content: with_('social', { linkedin: 'javascript:void(0)' }) }, 400);
eq(bad.field, 'social.linkedin', 'a refused value names its field');
eq((await publicSite()).content, base, 'and nothing changed');
const saved = (await call(owner, null, { action: 'site-save', content: changed })).site;
eq([saved.content, saved.updatedBy], [changed, 'contact@the1core.com'], 'saved, with who saved it');
eq(globalThis.testRevalidated, ['/accueil'], 'the public home is refreshed');
const pub = await publicSite();
eq([pub.content, pub.updatedAt, pub.updatedBy], [changed, saved.updatedAt, undefined], 'everyone reads it, without the editor’s e-mail');
ok(pub.cache.includes('s-maxage=60'), 'cached a minute at the edge');

// 4. The journal: every action, newest first, owner only.
const ws = (await call(owner, '')).companies.find((c) => c.name === 'Agence Test').id;
await call(owner, null, { action: 'extend-trial', workspaceId: ws, days: 7 });
await call(owner, null, { action: 'suspend', workspaceId: ws });
const log = (await call(owner, '?audit')).actions;
eq(log.map((e) => e.action), ['suspend', 'extend-trial', 'site-save'], 'every change, newest first');
eq([log[1].workspaceName, log[1].detail, log[1].actor], ['Agence Test', { days: 7 }, 'contact@the1core.com'], 'with the company, the detail and who did it');
await call(s, '?audit', null, 404);

// 5. The health card: tried for real where it can be, keys only never read as working, owner only.
const health = Object.fromEntries((await call(owner, '?health')).services.map((h) => [h.id, h]));
eq(health.database.state, 'ok', 'the database answered a real query');
eq(health.mail.state, 'off', 'no mail keys: not configured, not « working »');
eq(health.signup.state, 'warn', 'public sign-up left open is flagged');
ok(!JSON.stringify(health).includes('TOC-owner-test-password'), 'no secret in the answer');
await call(owner, null, { action: 'health-mail-test' }, 502);
await call(s, '?health', null, 404);
await call(s, null, { action: 'health-mail-test' }, 404);
globalThis.testEnv.CRON_SECRET = 'cron-secret-for-the-test';
eq(Object.fromEntries((await call(owner, '?health')).services.map((h) => [h.id, h.state])).cron, 'set', 'keys present say « set », never « ok »');
const down = await healthLib.serviceHealth({ query: async () => { throw new Error('postgres://user:hunter2@host failed'); } });
eq(down.find((h) => h.id === 'database').state, 'fail', 'a dead database is flagged');
ok(!JSON.stringify(down).includes('hunter2'), 'without the connection address');

await pg.close();
console.log(`${checks} platform console checks passed: service cost, revenue, cost level, overview and what needs the owner; the site's key information (defaults, validation, owner only, public and cached); the journal of every change.`);
