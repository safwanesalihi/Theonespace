// A workspace's own brand (lib/branding.ts, /api/records « set-brand »): who may change it, a name only
// for a company's own workspace, a logo only from that workspace's own logos, colours checked, the brand
// in every payload (the client portal too), the colour tokens, and the
// assistant speaking for the company instead of The One Core.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';

const esbuildPath = globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0] || 'node_modules/esbuild/lib/main.js';
const esbuild = await import(pathToFileURL(esbuildPath));
mkdirSync('.sites-runtime/brand-tests', { recursive: true });
await esbuild.build({
  entryPoints: { signup: 'app/api/auth/signup/route.ts', password: 'app/api/auth/password/route.ts', records: 'app/api/records/route.ts', assets: 'app/api/assets/route.ts', branding: 'lib/branding.ts', assistant: 'lib/assistant.ts' },
  outdir: '.sites-runtime/brand-tests', outExtension: { '.js': '.mjs' },
  bundle: true, platform: 'node', format: 'esm', external: ['nodemailer'],
  plugins: [testRuntimePlugin({ auth: true })],
});
const { db, pg } = await createTestDb();
globalThis.testDb = db;
const origin = 'https://localhost';
globalThis.testEnv = { AUTH_URL: origin, OWNER_EMAIL: 'contact@the1core.com', OWNER_PASSWORD: 'TOC-owner-test-password', PUBLIC_SIGNUP: 'on' };
const load = (n) => import(pathToFileURL(`${process.cwd()}/.sites-runtime/brand-tests/${n}.mjs`));
const [signup, password, records, assets, branding, assistant] = await Promise.all(['signup', 'password', 'records', 'assets', 'branding', 'assistant'].map(load));

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
  const v = await auth(signup, { action: 'verify', email, code: s.data.devCode, password: 'company-password-2026' });
  return { cookie: v.cookie, ws: v.data.workspaceId };
};

// 1. The colour tokens: a darker hover, a pale tint, readable text on the colour.
{
  const light = branding.brandTokens('#efb849'), dark = branding.brandTokens('#20232a');
  eq([light['--t-brand'], light['--t-brand-ink'], dark['--t-brand-ink']], ['#efb849', '#1b1a17', '#ffffff'], 'black text on a light colour, white on a dark one');
  ok(light['--t-brand-strong'] < light['--t-brand'] && light['--t-brand-tint-light'] > light['--t-brand'], 'hover darker, tint lighter');
  // Every preset, and a mid blue and teal: the text on the colour reaches 4.5:1, black never on a mid colour.
  const lum = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  for (const c of [...branding.brandPresets, '#3a7bd5', '#1e9e8f', '#2f9e44', '#e0533d', '#00bcd4', '#ffeb3b']) {
    const tk = branding.brandTokens(c);
    ok(ratio(lum(tk['--t-brand']), lum(tk['--t-brand-ink'])) >= 4.5, `readable text on ${c}`);
    for (const theme of ['light', 'dark']) {
      for (const bg of theme === 'light' ? ['#f4f5f7', '#ffffff', '#f7f8fa', tk['--t-brand-tint-light']] : ['#101216', '#1b1e24', '#22262e', tk['--t-brand-tint-dark']]) {
        ok(ratio(lum(tk[`--t-brand-text-${theme}`]), lum(bg)) >= 4.5, `${c}: brand label on ${theme} ${bg}`);
      }
    }
  }
  eq(['#3a7bd5', '#1e9e8f', '#2f9e44', '#e0533d'].map((c) => branding.brandTokens(c)['--t-brand-ink']), ['#ffffff', '#ffffff', '#ffffff', '#ffffff'], 'white, not black, on blue, teal, green and red');
  eq(branding.brandTokens('#3a7bd5')['--t-brand'] !== '#3a7bd5' && branding.brandTokens('#20232a')['--t-brand'], '#20232a', 'a mid blue is deepened a touch; a dark colour stays as chosen');
  eq([branding.isHexColor('#12ab9F'), branding.isHexColor('red'), branding.isHexColor('#fff'), branding.isHexColor('#12345g')], [true, false, false, false], 'only #rrggbb');
}

// 2. A company's workspace: the brand in the payload, editable by its owner.
const atlas = await signUp('sara@atlas.test', 'Atlas Studio');
eq((await get(atlas.cookie)).brand, { name: 'Atlas Studio' }, 'name only, until a logo and colour are chosen');
const logo = await upload(atlas.cookie, atlas.ws);
const set = await post(atlas.cookie, atlas.ws, { action: 'set-brand', name: '  Atlas Creative  ', logo, color: '#3A7BD5' });
eq(set.brand, { name: 'Atlas Creative', logo, color: '#3a7bd5' }, 'name, logo and colour saved (the colour lower-cased)');
eq((await get(atlas.cookie)).workspace.name, 'Atlas Creative', 'the workspace is renamed, and stays so');
await post(atlas.cookie, atlas.ws, { action: 'set-brand', name: 'A' }, 400);
await post(atlas.cookie, atlas.ws, { action: 'set-brand', color: 'blue' }, 400);
await post(atlas.cookie, atlas.ws, { action: 'set-brand', color: '#12345' }, 400);
const avatar = await upload(atlas.cookie, atlas.ws, 'avatar');
await post(atlas.cookie, atlas.ws, { action: 'set-brand', logo: avatar }, 400);
ok(true, 'a logo must be one of the workspace’s logos, not any picture');

// 3. Another company can't use Atlas's logo, nor change Atlas's brand.
const nova = await signUp('omar@nova.test', 'Nova Media');
await post(nova.cookie, nova.ws, { action: 'set-brand', logo }, 400);
await post(nova.cookie, atlas.ws, { action: 'set-brand', color: '#000000' }, 403);
eq((await get(atlas.cookie)).brand.color, '#3a7bd5', 'Atlas untouched');

// 4. Roles: a creative can't change it; the client portal gets it (for the sidebar and PDFs).
const client = await post(atlas.cookie, atlas.ws, { action: 'create', kind: 'client', data: { name: 'Client Atlas' } });
const creativeInvite = await post(atlas.cookie, atlas.ws, { action: 'invite-member', email: 'crea@atlas.test', name: 'Crea', role: 'creative' });
const contactInvite = await post(atlas.cookie, atlas.ws, { action: 'invite-member', email: 'client@atlas.test', name: 'Client', role: 'client', clientId: client.id });
const signInAs = async (email, temp) => {
  const first = await auth(password, { action: 'sign-in', email, password: temp });
  await password.POST(new Request(origin + '/api/auth/password', { method: 'POST', headers: { 'content-type': 'application/json', origin, cookie: first.cookie }, body: JSON.stringify({ action: 'change-password', currentPassword: temp, newPassword: `${email}-password` }) }));
  return (await auth(password, { action: 'sign-in', email, password: `${email}-password` })).cookie;
};
const crea = await signInAs('crea@atlas.test', creativeInvite.invitation.temporaryPassword);
await post(crea, atlas.ws, { action: 'set-brand', color: '#000000' }, 403);
const contact = await signInAs('client@atlas.test', contactInvite.invitation.temporaryPassword);
const portal = await get(contact);
eq([portal.workspace.role, portal.brand], ['client', { name: 'Atlas Creative', logo, color: '#3a7bd5' }], 'the client portal shows the company’s brand');

// 4b. A light logo with its dark twin and measured tone; how it shows on dark surfaces; a new logo resets them.
const twin = await upload(atlas.cookie, atlas.ws);
const withTwin = await post(atlas.cookie, atlas.ws, { action: 'set-brand', logo, logoLight: twin, logoTone: 'light' });
eq(withTwin.brand, { name: 'Atlas Creative', logo, logoLight: twin, logoTone: 'light', color: '#3a7bd5' }, 'a light logo keeps its dark twin and tone');
eq((await post(atlas.cookie, atlas.ws, { action: 'set-brand', logoOnDark: 'white' })).brand.logoOnDark, 'white', 'the dark-surface display is saved');
eq((await post(atlas.cookie, atlas.ws, { action: 'set-brand', logoOnDark: 'auto' })).brand.logoOnDark, undefined, "'auto' is the default, not stored");
await post(atlas.cookie, atlas.ws, { action: 'set-brand', logoOnDark: 'rainbow' }, 400);
const novaLogo = await upload(nova.cookie, nova.ws);
await post(atlas.cookie, atlas.ws, { action: 'set-brand', logo, logoLight: novaLogo }, 400);
ok(true, 'a twin from another workspace is refused');
await post(atlas.cookie, atlas.ws, { action: 'set-brand', logoOnDark: 'original' });
const renewed = await post(atlas.cookie, atlas.ws, { action: 'set-brand', logo, logoTone: 'dark' });
eq(renewed.brand, { name: 'Atlas Creative', logo, logoTone: 'dark', color: '#3a7bd5' }, 'a new logo drops the old twin and display choice');

// 5. Clearing: logo and colour back to the defaults.
eq((await post(atlas.cookie, atlas.ws, { action: 'set-brand', logo: null, color: null })).brand, { name: 'Atlas Creative' }, 'back to the defaults');

// 6. The studio: logo and colour allowed, the name stays; the retired print workspace cannot come back.
const studioOwner = (await auth(password, { action: 'sign-in', email: 'contact@the1core.com', password: 'TOC-owner-test-password' })).cookie;
const studio = await get(studioOwner);
eq(studio.brand, { name: 'The One Space' }, 'the studio’s brand by default');
await post(studioOwner, studio.workspace.id, { action: 'set-brand', name: 'Autre nom' }, 400);
eq((await post(studioOwner, studio.workspace.id, { action: 'set-brand', color: '#2f9e44' })).brand.color, '#2f9e44', 'the studio may pick a colour');
await post(studioOwner, studio.workspace.id, { action: 'create-print-workspace' }, 400);

// 7. The assistant speaks for the company, and never presents The One Core as its agency.
{
  const forCompany = assistant.assistantPrompt({ role: 'owner', company: 'Atlas Creative' });
  ok(forCompany.includes('used by Atlas Creative') && forCompany.includes('never invent its services'), 'the company’s assistant');
  ok(!forCompany.includes(assistant.AGENCY.trim().slice(0, 60)), 'none of The One Core’s agency facts');
  const forStudio = assistant.assistantPrompt({ role: 'owner' });
  ok(forStudio.includes(assistant.AGENCY.trim().slice(0, 60)), 'the studio keeps its own');
}

await pg.close();
console.log(`${checks} branding checks passed: colour tokens, company name/logo/colour, only the workspace's own logos, companies can't touch each other's brand, creatives refused, the portal gets the brand, reset to defaults, the studio keeps its name, the print workspace stays retired, the assistant speaks for the company.`);
