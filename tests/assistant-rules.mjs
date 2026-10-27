// The assistant states the studio's own process (lib/assistant.ts flowGuide): its steps and paths, its
// milestones, its freeze and what the client's silence does. A client reads the portal's words.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const esbuild = await import(pathToFileURL(globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0]));
mkdirSync('.sites-runtime', { recursive: true });
await esbuild.build({ stdin: { contents: "export * from './lib/assistant'; export { oneCoreProcess } from './lib/process';", resolveDir: process.cwd() }, outfile: '.sites-runtime/assistant-rules-lib.mjs', bundle: true, platform: 'node', format: 'esm', logLevel: 'error', external: ['node:*'] });
const lib = await import(pathToFileURL(process.cwd() + '/.sites-runtime/assistant-rules-lib.mjs'));

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

// The One Core's process: the historical numbers.
const usual = lib.assistantPrompt({ role: 'owner' });
ok(usual.includes('J-7 lock') && usual.includes('at J-14') && usual.includes('Silence = approval'), 'The One Flow by default');
ok(usual.includes('À faire (Pas commencé) → En cours (En production)'), 'its six statuses, each with what it does');

// A studio with its own paths, a 3-day freeze, other milestones and no silent approval.
const s = (id, label, behaviour) => ({ id, label, behaviour, color: 'blue' });
const studio = {
  ...lib.oneCoreProcess,
  statuses: [s('idea', 'Idée', 'todo'), s('edit', 'Montage', 'work'), s('da', 'Check DA', 'internal'), s('client', 'Chez le client', 'client'), s('live', 'Publié', 'done')],
  workTypes: [{ id: 'reel', label: 'Reel', statusIds: ['idea', 'edit', 'da', 'client', 'live'] }, { id: 'memo', label: 'Note interne', statusIds: ['idea', 'edit', 'live'] }],
  rules: { lockDays: 3, archiveAfterDays: 0, gates: { brief: 10 } },
  portal: { words: { client: 'À relire' } },
};
const settings = { validationHours: 24, maxRevisionRounds: 1, onSilence: 'remind' };
const team = lib.assistantPrompt({ role: 'owner', process: studio, settings });
ok(team.includes('  - Reel: Idée (Pas commencé) → Montage (En production) → Check DA (Validation interne) → Chez le client (Chez le client) → Publié (Terminé)'), 'each work type’s path');
ok(team.includes('  - Note interne: Idée (Pas commencé) → Montage (En production) → Publié (Terminé)'));
ok(team.includes('J-3 lock') && !team.includes('J-7 lock'), 'its own freeze');
ok(team.includes('at J-10') && team.includes('Envoi au client at J-7'), 'its own milestones, the others by default');
ok(team.includes('it is NOT approved by silence') && !team.includes('Silence = approval'), 'its silence rule');
ok(team.includes('only when someone archives it'), 'no automatic archiving');
ok(team.includes('no change inside the J-3 lock'), 'the hard rule names its freeze');

const none = lib.assistantPrompt({ role: 'owner', process: { ...studio, rules: { lockDays: 0 } }, settings });
ok(none.includes('No freeze') && !none.includes('lock, no deadline'), 'no freeze: none mentioned');

// The client reads the portal's words, never the studio's steps.
const client = lib.assistantPrompt({ role: 'client', process: studio, settings });
ok(client.includes('→ À relire (in the client\'s court)') && !client.includes('Check DA'), 'the client’s words, no internal step');

console.log(`assistant rules: ${checks} checks passed`);
