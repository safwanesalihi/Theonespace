// Client JavaScript a browser downloads to open each app route, from the build's manifests: the root
// main files plus the chunks the route's layout and page reference (dynamic imports load later and
// are not counted). Run after `pnpm build`. Not part of `pnpm test`.
// Usage: node scripts/bench/bundle.mjs [--json]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const next = '.next';
const rootMain = JSON.parse(readFileSync(join(next, 'build-manifest.json'), 'utf8')).rootMainFiles ?? [];
const size = (file) => { const bytes = readFileSync(join(next, file)); return [bytes.length, gzipSync(bytes).length]; };
const manifests = [];
const walk = (dir) => { for (const entry of readdirSync(dir)) { const path = join(dir, entry); if (statSync(path).isDirectory()) walk(path); else if (entry.endsWith('page_client-reference-manifest.js')) manifests.push(path); } };
walk(join(next, 'server', 'app'));
const routes = {};
for (const file of manifests) {
  const text = readFileSync(file, 'utf8');
  const start = text.indexOf('{', text.indexOf('] = '));
  const entries = JSON.parse(text.slice(start, text.lastIndexOf('}') + 1)).entryJSFiles ?? {};
  const page = Object.keys(entries).find((key) => key.endsWith('/page'));
  if (!page) continue;
  const route = page.replace('[project]/app', '').replace(/\/page$/, '') || '/';
  if (route.startsWith('/api')) continue;
  const layouts = Object.keys(entries).filter((key) => key.endsWith('/layout') && page.startsWith(key.replace(/\/layout$/, '')));
  const files = [...new Set([...rootMain, ...layouts.flatMap((key) => entries[key]), ...entries[page]])].filter((f) => f.endsWith('.js'));
  let raw = 0, gz = 0;
  for (const f of files) { const [r, g] = size(f); raw += r; gz += g; }
  routes[route] = { scripts: files.length, raw, gzip: gz };
}
const chunks = readdirSync(join(next, 'static', 'chunks')).filter((f) => f.endsWith('.js'));
let total = 0, totalGz = 0;
for (const f of chunks) { const [r, g] = size(join('static', 'chunks', f)); total += r; totalGz += g; }
const kib = (n) => (n / 1024).toFixed(1);
if (process.argv.includes('--json')) console.log(JSON.stringify({ routes, all: { files: chunks.length, raw: total, gzip: totalGz } }));
else {
  for (const [route, r] of Object.entries(routes).sort()) console.log(`${route.padEnd(28)} ${String(r.scripts).padStart(3)} scripts ${kib(r.raw).padStart(8)} KiB raw ${kib(r.gzip).padStart(7)} KiB gzip`);
  console.log(`${'all client chunks'.padEnd(28)} ${String(chunks.length).padStart(3)} files   ${kib(total).padStart(8)} KiB raw ${kib(totalGz).padStart(7)} KiB gzip`);
}
