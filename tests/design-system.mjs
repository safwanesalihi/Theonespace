import {strict as assert} from 'node:assert';
import {readFileSync,globSync,existsSync} from 'node:fs';
import ts from 'typescript';
import {createRequire} from 'node:module';
const req=createRequire(import.meta.url),postcss=createRequire(req.resolve('@tailwindcss/postcss'))('postcss');
const ignore=createRequire(req.resolve('eslint'))('ignore');
const deploymentFiles=ignore().add(readFileSync('.vercelignore','utf8'));
const postbuild=JSON.parse(readFileSync('package.json','utf8')).scripts.postbuild;
const checker=postbuild.match(/^node (\S+) --compiled$/)?.[1];
assert.ok(checker&&existsSync(checker),'The production contrast checker must exist');
assert.ok(!deploymentFiles.ignores(checker),'Vercel must receive the postbuild checker');
for(const file of ['styles/design-tokens.css','features/landing/landing.css']) {
  assert.ok(!deploymentFiles.ignores(file),`Vercel must receive checker input ${file}`);
}
const layout=readFileSync('app/layout.tsx','utf8');
assert.deepEqual([...layout.matchAll(/import "(.+\.css)"/g)].map(m=>m[1]),['./styles.css'],'Root has one ordered stylesheet entry');
const entry=readFileSync('app/styles.css','utf8');
assert.ok(entry.indexOf('design-tokens.css')<entry.indexOf('modern.css')&&entry.indexOf('design-system.css')>entry.indexOf('theme.css'),'Palette before layouts, templates after layouts');
const owned=new Set('work-panel review-panel setup-card onboarding-card client-card team-card lib-card lib-link-card metric-card live-metric live-panel meeting-card post-card review-card pc-rich-card pc-list-card ph-summary-card ph-card print-panel print-order print-stat request-card account-card plan-card database-card board-card mm-node mm-branch mm-center platform-row'.split(' '));
let covered=0,modules=0;
// Every screen and shared component, wherever its feature lives.
for(const file of globSync('{app,features,components}/**/*.tsx')) {
  const source=readFileSync(file,'utf8'),ast=ts.createSourceFile(file,source,99,true,4);
  let count=0;
  function visit(node) {
    if(ts.isJsxElement(node)) {
      const opening=node.openingElement;
      if(opening.tagName.getText(ast)==='Surface') {count++;assert.ok(!node.children.some(child=>ts.isJsxElement(child)&&child.openingElement.attributes.properties.some(a=>a.name?.getText(ast)==='key')),'List keys must be on the Surface');}
      const klass=opening.attributes.properties.find(a=>a.name?.getText(ast)==='className');
      const text=klass?.initializer?.getText(ast)||'';
      if(['div','button','section','article','a'].includes(opening.tagName.getText(ast))&&[...owned].some(name=>new RegExp('(?<![\\w-])'+name+'(?![\\w-])').test(text))) {
        assert.ok(ts.isJsxElement(node.parent)&&node.parent.openingElement.tagName.getText(ast)==='Surface',`${file}: ${text} must use Surface`);
      }
    }
    ts.forEachChild(node,visit);
  }
  visit(ast);covered+=count;if(count)modules++;
}
// One palette: no other stylesheet (global, feature or module) redefines the root tokens.
for(const file of globSync('{app,features,components,styles}/**/*.css')) {
  if(file.endsWith('design-tokens.css'))continue;
  postcss.parse(readFileSync(file,'utf8')).walkRules(':root',rule=>{
    if(rule.parent.name==='media'&&rule.parent.params==='print')return;
    rule.walkDecls(/^--t-(brand|text|page|surface|line|shadow|focus)/,d=>assert.fail(`${file}: duplicate root palette ${d.prop}`));
  });
}
// 96 since the print workspace's screens were removed and the dashboard was cut down to four blocks
// (October 2026); otherwise the floor only ever rises.
assert.ok(covered>=96&&modules>=23,'All workspace card families remain migrated');
const system=readFileSync('styles/design-system.css','utf8');
assert.ok(!system.includes('!important'),'Shared templates must not start an override arms race');
assert.ok(system.includes('prefers-reduced-motion')&&system.includes('min-height: 44px')&&system.includes(':focus-visible'),'Templates include keyboard, motion and mobile interactions');
console.log(`Design system checks passed: ${covered} surfaces across ${modules} modules; one palette and stylesheet entry.`);
