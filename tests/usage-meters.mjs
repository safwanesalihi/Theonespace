// What a company may spend of The One Core's paid services each month (lib/plans.ts meters, lib/subscription.ts
// countUsage): Instagram readings, meeting minutes counted once per person and meeting, WhatsApp messages
// given back when not sent; and production failures kept for the Plateforme page (lib/error-report.ts).
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createTestDb, testRuntimePlugin } from './helpers/pg.mjs';

const esbuild = await import(pathToFileURL(globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0]));
mkdirSync('.sites-runtime/usage-meters', { recursive: true });
await esbuild.build({
  entryPoints: { subscription: 'lib/subscription.ts', whatsapp: 'lib/task-whatsapp.ts', errors: 'lib/error-report.ts', plans: 'lib/plans.ts' },
  outdir: '.sites-runtime/usage-meters', outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node', format: 'esm', logLevel: 'error',
  external: ['nodemailer'], plugins: [testRuntimePlugin()],
});
const { db } = await createTestDb();
globalThis.testDb = db;
globalThis.testEnv = { OWNER_EMAIL: 'owner@example.com' };
const load = (n) => import(pathToFileURL(`${process.cwd()}/.sites-runtime/usage-meters/${n}.mjs`));
const [{ countUsage, releaseUsage, usageOf }, { meteredWhatsapp }, { reportError, recentErrors }, { overLimit, plans, limitMessages }] =
  await Promise.all(['subscription', 'whatsapp', 'errors', 'plans'].map(load));

let checks = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const company = 'ws:org:atlas';
const trial = plans.trial.limits;

// Instagram readings: the trial's 5, then refused; a reading given back can be used again.
for (let i = 0; i < trial.igPerMonth; i++) eq(await countUsage(company, 'igPerMonth'), true, `reading ${i + 1}`);
eq(await countUsage(company, 'igPerMonth'), false, 'over the plan: refused');
eq((await usageOf(company)).igThisMonth, trial.igPerMonth, 'nothing counted past the limit');
await releaseUsage(company, 'igPerMonth');
eq((await usageOf(company)).igThisMonth, trial.igPerMonth - 1, 'given back');
eq(await countUsage(company, 'igPerMonth'), true, 'usable again');

// The One Core's own workspaces have no plan and no meter.
for (let i = 0; i < 20; i++) assert.equal(await countUsage('ws:owner-a', 'igPerMonth'), true);
checks++;

// Meeting minutes: once per person and meeting; a refused one is not marked, so it can be counted later.
eq(await countUsage(company, 'meetingMinutesPerMonth', 120, { once: 'meeting:m1:u1' }), true);
eq(await countUsage(company, 'meetingMinutesPerMonth', 120, { once: 'meeting:m1:u1' }), true, 'rejoining is free');
eq((await usageOf(company)).meetingMinutesThisMonth, 120, 'counted once');
eq(await countUsage(company, 'meetingMinutesPerMonth', 200, { once: 'meeting:m2:u1' }), false, '120 + 200 is over 300');
eq(await countUsage(company, 'meetingMinutesPerMonth', 150, { once: 'meeting:m2:u1' }), true, 'the refused key was not kept');
eq((await usageOf(company)).meetingMinutesThisMonth, 270);

// WhatsApp: a message sent counts; one not sent is given back; past the plan, nothing is sent.
let calls = 0;
const sent = () => { calls++; return Promise.resolve({ sent: true, messageId: 'wamid.1' }); };
const refused = () => { calls++; return Promise.resolve({ sent: false, error: 'Numéro WhatsApp invalide.' }); };
eq((await meteredWhatsapp(company, sent)).sent, true);
eq((await meteredWhatsapp(company, refused)).sent, false);
eq((await usageOf(company)).whatsappThisMonth, 1, 'the refused message gave its unit back');
for (let i = 1; i < trial.whatsappPerMonth; i++) await meteredWhatsapp(company, sent);
calls = 0;
const over = await meteredWhatsapp(company, sent);
eq([over.sent, over.error, calls], [false, limitMessages.whatsappPerMonth, 0], 'past the plan: Meta is never called');

// The limits read the right counter.
const usage = { members: 1, clients: 1, storageMb: 1, aiThisMonth: 0, igThisMonth: 5, meetingMinutesThisMonth: 0, whatsappThisMonth: 0 };
eq(overLimit(trial, usage, 'igPerMonth'), 'igPerMonth');
eq(overLimit(trial, usage, 'meetingMinutesPerMonth', 60), null);

// Failures: the same error in the same area is one entry with a count; another is its own entry.
const quiet = console.error; console.error = () => {};
await reportError('records-save', new Error('connection reset'), { workspaceId: company });
await reportError('records-save', new Error('connection reset'), { workspaceId: company });
await reportError('publishing-late', new Error('posts late'));
console.error = quiet;
const errors = await recentErrors();
eq(errors.length, 2);
eq(errors.find((e) => e.area === 'records-save')?.count, 2, 'grouped');
eq(errors.find((e) => e.area === 'records-save')?.workspaceId, company);

console.log(`usage meters and error log: ${checks} checks passed`);
