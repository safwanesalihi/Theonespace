// Dependency rules of the codebase (docs/architecture.md), checked on the import graph of the repo's own
// modules ('@/…' and relative imports; type-only imports excluded, since they vanish at runtime):
//   1. no import cycles;
//   2. no browser module ('use client', and everything it imports) reaches a server-only module — one
//      that touches the database, secrets, request headers, Node built-ins or a server driver, or lives
//      under a server/ folder or app/api;
//   3. lib/ and components/ never import features/ or app/; features/ never imports app/;
//   4. a features/*/server module never imports a browser module.
// Usage: node scripts/check-architecture.mjs [--verbose]
import { strict as assert } from 'node:assert';
import { existsSync, globSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

const root = process.cwd();
const files = globSync('{app,lib,components,hooks,features}/**/*.{ts,tsx}', { cwd: root }).filter((f) => !f.includes('node_modules')).sort();
const extensions = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];
function resolveSpec(from, spec) {
  let base;
  if (spec.startsWith('@/')) base = resolve(root, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(resolve(root, from)), spec);
  else return null;
  for (const e of extensions) { const p = base + e; if (existsSync(p) && statSync(p).isFile()) return relative(root, p); }
  return null;
}

/** Packages and built-ins that only exist on the server. */
const serverPackages = /^(node:|next\/headers$|postgres$|nodemailer$|@electric-sql\/pglite)/;
const graph = new Map();
const external = new Map();
const isClient = new Map();
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  isClient.set(file, /^\s*(\/\/[^\n]*\n\s*)*['"]use client['"]/.test(source));
  const deps = new Set(), packages = new Set();
  const specs = [
    ...[...source.matchAll(/(?:^|\n)\s*(import|export)\s+(type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g)].filter((m) => !m[2]).map((m) => m[3]),
    ...[...source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
  ];
  for (const spec of specs) {
    const target = resolveSpec(file, spec);
    if (target) deps.add(target); else packages.add(spec);
  }
  graph.set(file, deps);
  external.set(file, packages);
}

const failures = [];

// 1. cycles
{
  const seen = new Set(), onStack = new Set(), stack = [], reported = new Set();
  const visit = (node) => {
    onStack.add(node); stack.push(node);
    for (const dep of graph.get(node) ?? []) {
      if (onStack.has(dep)) {
        const cycle = stack.slice(stack.indexOf(dep));
        const key = [...cycle].sort().join('|');
        if (!reported.has(key)) { reported.add(key); failures.push(`import cycle: ${[...cycle, dep].join(' → ')}`); }
      } else if (!seen.has(dep)) visit(dep);
    }
    stack.pop(); onStack.delete(node); seen.add(node);
  };
  for (const file of files) if (!seen.has(file)) visit(file);
}

// 2. browser modules never reach server-only ones
const directlyServer = (file) => file.startsWith('app/api/') || /(^|\/)server\//.test(file)
  || ['lib/database.ts', 'lib/env.ts', 'lib/auth.ts'].includes(file)
  || [...(external.get(file) ?? [])].some((p) => serverPackages.test(p));
// A module whose own imports reach the server is server-only too — unless it is itself a browser
// module (a 'use client' boundary that imports a server action would be its own failure below).
const serverOnly = new Map();
const isServerOnly = (file, trail = new Set()) => {
  if (serverOnly.has(file)) return serverOnly.get(file);
  if (trail.has(file)) return false;
  trail.add(file);
  const answer = directlyServer(file) || (!isClient.get(file) && [...graph.get(file) ?? []].some((d) => isServerOnly(d, trail)));
  trail.delete(file);
  serverOnly.set(file, answer);
  return answer;
};
for (const file of files) isServerOnly(file);
let clientModules = 0;
for (const file of files.filter((f) => isClient.get(f))) {
  clientModules++;
  const queue = [file], seen = new Set(queue), via = new Map();
  while (queue.length) {
    const node = queue.shift();
    for (const dep of graph.get(node) ?? []) {
      if (seen.has(dep)) continue;
      seen.add(dep); via.set(dep, node);
      if (isServerOnly(dep)) failures.push(`browser module ${file} reaches server-only ${dep} (imported by ${node})`);
      else queue.push(dep);
    }
  }
}

// 3. dependency direction, 4. server code never imports browser modules
for (const [file, deps] of graph) {
  for (const dep of deps) {
    if ((file.startsWith('lib/') || file.startsWith('components/') || file.startsWith('hooks/')) && (dep.startsWith('features/') || dep.startsWith('app/'))) failures.push(`${file} imports ${dep}: lib/ and components/ never depend on features/ or app/`);
    if (file.startsWith('features/') && dep.startsWith('app/')) failures.push(`${file} imports ${dep}: features/ never depend on app/`);
    if (/^features\/[^/]+\/server\//.test(file) && isClient.get(dep)) failures.push(`${file} imports the browser module ${dep}`);
  }
}

if (process.argv.includes('--verbose') || failures.length) {
  console.log(`${files.length} modules, ${clientModules} browser modules, ${[...serverOnly.values()].filter(Boolean).length} server-only modules`);
}
assert.deepEqual(failures, [], `architecture rules broken:\n${failures.join('\n')}`);
console.log(`architecture: ${files.length} modules, ${clientModules} browser modules, no cycles, dependency rules hold`);
