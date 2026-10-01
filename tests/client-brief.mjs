import { strict as assert } from 'node:assert';
import { globSync, mkdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const esbuildPath = globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0];
const esbuild = await import(pathToFileURL(esbuildPath));
mkdirSync('.sites-runtime', { recursive: true });
await esbuild.build({ entryPoints: ['lib/client-brief.ts', 'lib/validation.ts'], outdir: '.sites-runtime/brief-test', bundle: true, platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' } });
const { emptyBrief, parseBriefFile, briefHasContent, briefSections } = await import(pathToFileURL(`${process.cwd()}/.sites-runtime/brief-test/client-brief.mjs`));
const { fields } = await import(pathToFileURL(`${process.cwd()}/.sites-runtime/brief-test/validation.mjs`));
const template = JSON.parse(readFileSync('public/brief-marque-modele.json', 'utf8'));
assert.deepEqual(parseBriefFile(template), { brief: template });
assert.deepEqual(parseBriefFile(JSON.parse(JSON.stringify(template))), { brief: template }, 'portable JSON round trip');
assert.equal(briefSections.filter((section) => briefHasContent(template, section)).length, 6);
assert.equal(briefSections.filter((section) => briefHasContent(emptyBrief(), section)).length, 0);
assert.equal(parseBriefFile(emptyBrief('x'.repeat(15000))).brief.overview.length, 15000, 'legacy descriptions are preserved');
for (const value of [null, [], { ...template, version: 2 }, { ...template, identity: { ...template.identity, colors: [{ name: 'Unsafe', value: 'red;url(x)' }] } }, { ...template, references: [{ id: 'unsafe', label: 'Unsafe', url: 'javascript:alert(1)' }] }, { ...template, references: [{ id: 'unsafe', label: 'Unsafe', url: 'data:text/html,test' }] }, { ...template, goals: [template.goals[0], template.goals[0]] }, { ...template, requirements: [{ id: 'x', text: 'Test', priority: 'admin' }] }, { ...template, goals: Array.from({ length: 21 }, (_, i) => ({ id: String(i), title: 'Goal', measure: '' })) }, { ...template, audience: 'x'.repeat(5001) }, { ...template, clientId: 'other-client' }]) {
  assert.ok('error' in parseBriefFile(value), 'malformed/unsafe/unsupported brief rejected');
  assert.equal(fields.safeParse({ name: 'Client', brief: value }).success, false, 'API and JSON editor enforce the same schema');
}
assert.deepEqual(fields.parse({ name: 'Client', brief: template }).brief, template);
console.log('Client brief checks passed: JSON round trip, migration, all sections, unsafe URLs/colors, duplicate ids, bounded content and API schema.');
