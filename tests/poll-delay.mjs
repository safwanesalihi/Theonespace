// How often an open tab asks for changes (lib/poll-delay.ts): the 5 seconds a person at work expects, slower for a
// tab left alone, so that many open tabs don't each cost the server a call every 5 seconds all day.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const esbuild = await import(pathToFileURL(globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0] || 'node_modules/esbuild/lib/main.js'));
mkdirSync('.sites-runtime', { recursive: true });
await esbuild.build({ entryPoints: ['lib/poll-delay.ts'], outfile: '.sites-runtime/poll-delay.mjs', bundle: true, platform: 'node', format: 'esm' });
const { pollDelay, pollDelays, quietAfterMs, idleAfterMs } = await import(pathToFileURL(`${process.cwd()}/.sites-runtime/poll-delay.mjs`));

let checks = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

eq([pollDelay(0), pollDelay(quietAfterMs - 1)], [5000, 5000], 'a person at work keeps the 5 seconds');
eq([pollDelay(quietAfterMs), pollDelay(idleAfterMs - 1)], [15000, 15000], 'a quiet tab asks every 15 seconds');
eq([pollDelay(idleAfterMs), pollDelay(60 * 60_000)], [45000, 45000], 'an abandoned tab asks every 45 seconds');
eq(pollDelays.active < pollDelays.quiet && pollDelays.quiet < pollDelays.idle, true, 'each step is slower than the one before');
// Eight hours with the page open: always active, then a tab left alone after ten minutes of work.
const callsIn = (ms, delay) => Math.floor(ms / delay);
const hour = 3_600_000;
eq([callsIn(hour, pollDelays.active), callsIn(hour, pollDelays.idle)], [720, 80], 'calls per hour: 720 at work, 80 left alone');

console.log(`poll delay: ${checks} checks passed`);
