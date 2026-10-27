// « Build your agency » (lib/agency-builder.ts): the answers of the guided setup become a valid process —
// the model's statuses, the agency's chain of checks just before the client, one path per kind of work,
// the channels it switched off — and the game is offered once, to a new agency's owner only.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const esbuild = await import(pathToFileURL(globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0]));
mkdirSync('.sites-runtime', { recursive: true });
await esbuild.build({ stdin: { contents: "export * from './lib/agency-builder'; export { processSchema, oneCoreProcess, flowFor, notifies } from './lib/process'; export { presets } from './lib/process-presets';", resolveDir: process.cwd() }, outfile: '.sites-runtime/agency-builder-lib.mjs', bundle: true, platform: 'node', format: 'esm', logLevel: 'error' });
const lib = await import(pathToFileURL(process.cwd() + '/.sites-runtime/agency-builder-lib.mjs'));

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const valid = (p) => { const r = lib.processSchema.safeParse(p); return r.success ? [] : r.error.issues.map((i) => i.message); };
const on = { whatsapp: true, email: true };

// Every model, with any answers, builds a valid process.
for (const preset of lib.presets.map((p) => p.id)) {
  for (const answers of [
    { preset, workTypes: [], checks: [], channels: on },
    { preset, workTypes: ['Reel', 'Carrousel', 'Story'], checks: ['Check DA'], channels: on },
    { preset, workTypes: [...lib.workIdeas], checks: [...lib.checkIdeas], channels: { whatsapp: false, email: false } },
  ]) eq(valid(lib.buildAgency(answers)), [], `${preset}: ${answers.workTypes.length} types, ${answers.checks.length} checks`);
}

// The social media model: the agency's chain replaces the model's single check, just before the client.
const social = lib.buildAgency({ preset: 'social', workTypes: ['Reel', 'Carrousel'], checks: ['Relecture', 'Check DA'], channels: { whatsapp: false, email: true } });
const ids = social.statuses.map((s) => s.label);
const at = ids.indexOf('Chez le client');
eq(ids.slice(at - 2, at + 1), ['Relecture', 'Check DA', 'Chez le client'], 'the checks, in order, then the client');
eq(social.statuses.filter((s) => s.behaviour === 'internal').map((s) => s.label), ['Relecture', 'Check DA'], 'no other internal step');
eq(social.workTypes.map((w) => [w.id, w.label]), [['wt-reel', 'Reel'], ['wt-carrousel', 'Carrousel']], 'one work type per kind of work');
eq(lib.flowFor(social, { workType: 'wt-reel' }).statuses.length, social.statuses.length, 'each path starts with every step');
eq([lib.notifies(social, 'assigned', 'whatsapp'), lib.notifies(social, 'approved', 'whatsapp'), lib.notifies(social, 'approved', 'email'), lib.notifies(social, 'meeting', 'email')], [false, false, true, true], 'WhatsApp off, e-mail on');
ok(social.built === true, 'marked as built');

// No checks: the work goes straight to the client. Duplicates and blanks are dropped; names stay short.
const plain = lib.buildAgency({ preset: 'one-core', workTypes: [' Reel ', 'reel', '', 'Vidéo'], checks: [], channels: on });
ok(!plain.statuses.some((s) => s.behaviour === 'internal'), 'no internal step');
eq(plain.workTypes.map((w) => w.label), ['Reel', 'Vidéo'], 'clean, unique names');
eq(plain.notifications, undefined, 'every channel on: nothing stored');
const accents = lib.buildAgency({ preset: 'one-core', workTypes: ['Identité visuelle', 'Événement'], checks: [], channels: on });
eq(accents.workTypes.map((w) => w.id), ['wt-identite-visuelle', 'wt-evenement'], 'readable ids');

// Offered once: a new agency's owner, before anything is set up.
const fresh = { workspaceId: 'ws:org:atlas', owner: true, process: lib.oneCoreProcess, processRevision: 1, hasWork: false };
ok(lib.offersBuild(fresh), 'a new agency’s owner plays it');
ok(!lib.offersBuild({ ...fresh, owner: false }), 'not a member');
ok(!lib.offersBuild({ ...fresh, workspaceId: 'ws:owner-a' }), 'not The One Core’s own workspace');
ok(!lib.offersBuild({ ...fresh, process: { ...lib.oneCoreProcess, built: true } }), 'not twice');
ok(!lib.offersBuild({ ...fresh, processRevision: 2 }), 'not after the board was used');
ok(!lib.offersBuild({ ...fresh, hasWork: true }), 'not once work exists');

console.log(`agency builder: ${checks} checks passed`);
