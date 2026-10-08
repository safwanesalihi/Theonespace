// Translations (lib/i18n): every French key lives in one catalog, nothing is left empty, the {name}
// placeholders of the French source survive in English and Arabic, and translate() falls back to
// French and fills placeholders.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const esbuild = await import(pathToFileURL(globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0]));
mkdirSync('.sites-runtime', { recursive: true });
await esbuild.build({
  stdin: { contents: "export * from './lib/i18n/catalog'; export * from './lib/i18n/printing'; export * from './lib/i18n/pipeline'; export * from './lib/i18n/drive'; export { translate, localeMeta } from './lib/i18n';", resolveDir: process.cwd() },
  outfile: '.sites-runtime/i18n-test.mjs', bundle: true, platform: 'node', format: 'esm',
});
const i18n = await import(pathToFileURL(process.cwd() + '/.sites-runtime/i18n-test.mjs'));
let assertions = 0;

// One home per key: a key in two catalogs would let file order decide its translation.
const seen = new Map();
for (const [area, catalog] of Object.entries(i18n.catalogs)) {
  for (const key of Object.keys(catalog)) {
    assert.ok(!seen.has(key), `« ${key} » is in both ${seen.get(key)} and ${area}`);
    seen.set(key, area);
  }
}
assertions++;
assert.ok(seen.size > 2500, 'the catalogs hold the app’s strings'); assertions++;

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const dictionaries = {
  catalogs: [i18n.catalogEn, i18n.catalogAr],
  printing: [i18n.printingEn, i18n.printingAr],
  pipeline: [i18n.pipelineEn, i18n.pipelineAr],
  drive: [i18n.driveEn, i18n.driveAr],
};
for (const [name, [en, ar]] of Object.entries(dictionaries)) {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ar).sort(), `${name}: English and Arabic cover the same keys`);
  for (const [key, value] of [...Object.entries(en), ...Object.entries(ar)]) {
    assert.ok(value.trim(), `${name}: « ${key} » has an empty translation`);
    assert.equal(placeholders(value), placeholders(key), `${name}: « ${key} » → « ${value} » changes its placeholders`);
  }
  assertions += 3;
}

// translate(): French is the source, a missing entry falls back to it, placeholders are filled.
assert.equal(i18n.translate('fr', 'Annuler'), 'Annuler');
assert.equal(i18n.translate('en', 'Annuler'), 'Cancel');
assert.equal(i18n.translate('en', 'Une phrase qui n’existe pas'), 'Une phrase qui n’existe pas');
assert.equal(i18n.translate('en', 'Ouvrir {name}', { name: 'Atlas' }), 'Open Atlas');
assert.equal(i18n.translate('ar', '{n} tâches', { n: 3 }).includes('3'), true);
assert.equal(i18n.localeMeta.ar.dir, 'rtl');
assertions += 6;

console.log(`i18n: ${seen.size} keys in ${Object.keys(i18n.catalogs).length} catalogs, ${assertions} assertions passed`);
