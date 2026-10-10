// Work in the background (features/workspace/background-work.tsx): it runs on its own, outside the window
// that started it, can't start twice under one key, keeps its result for the screen that wants it, and
// tells how it ended through the studio's notice and error banners.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { testRuntimePlugin } from './helpers/pg.mjs';

const esbuild = await import(pathToFileURL(globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0]));
mkdirSync('.sites-runtime', { recursive: true });
await esbuild.build({ entryPoints: ['features/workspace/background-work.tsx'], outfile: '.sites-runtime/background-work-test.mjs', bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', plugins: [testRuntimePlugin({ auth: false })] });
const bg = await import(pathToFileURL(`${process.cwd()}/.sites-runtime/background-work-test.mjs`));

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const notices = [], errors = [];
bg.setBackgroundReport({ notice: (t) => notices.push(t), error: (t) => errors.push(t) });
const later = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const settle = () => new Promise((r) => setTimeout(r, 0));

// 1. It runs on its own and can't start twice under one key.
const publish = later();
ok(bg.runInBackground({ key: 'publish:p1', label: 'Publication de « Rentrée »', work: () => publish.promise, done: (n) => `« Rentrée » est publié sur ${n} réseaux.` }), 'started');
ok(!bg.runInBackground({ key: 'publish:p1', label: 'again', work: () => Promise.resolve(0) }), 'the same work twice: refused while it runs');
const other = later();
ok(bg.runInBackground({ key: 'brief:c1', label: 'Brief de « Kojo » par l’IA', work: () => other.promise }), 'other work runs beside it');
eq(bg.runningJobs().map((j) => j.label), ['Publication de « Rentrée »', 'Brief de « Kojo » par l’IA'], 'both shown in the panel');
ok(bg.runningJobs().every((j) => typeof j.startedAt === 'number'), 'each with when it started');

// 2. Its end: the notice says how it went; its result waits for the screen that wants it.
publish.resolve(2);
await settle();
eq(notices, ['« Rentrée » est publié sur 2 réseaux.'], 'the notice at the end');
eq(bg.runningJobs().map((j) => j.key), ['brief:c1'], 'gone from the panel');
eq(bg.resultFor('publish:p1'), 2, 'its result is kept');
bg.clearResult('publish:p1');
eq(bg.resultFor('publish:p1'), undefined, 'until the screen is done with it');
ok(bg.runInBackground({ key: 'publish:p1', label: 'again', work: () => Promise.resolve(1) }), 'and it can run again once ended');
await settle();

// 3. A failure: its message as an error, or nothing when the screen showed it itself.
other.reject(new Error('L’IA ne répond pas pour le moment. Réessayez.'));
await settle();
eq(errors, ['L’IA ne répond pas pour le moment. Réessayez.'], 'the error by default');
bg.runInBackground({ key: 'quiet', label: 'x', work: () => Promise.reject(new Error('shown on the page')), failed: () => null });
await settle();
eq(errors.length, 1, 'nothing more when the screen handled it');
bg.runInBackground({ key: 'silent', label: 'x', work: () => Promise.resolve('ok'), done: () => null });
await settle();
eq([notices.length, bg.runningJobs().length], [1, 0], 'no notice when there is nothing to say; nothing left running');

console.log(`${checks} background work checks passed: runs on its own, once per key, results kept, outcomes told.`);
