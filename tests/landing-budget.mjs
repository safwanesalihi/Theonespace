// The landing's byte budget: what a visitor's phone downloads before the page is up.
// On the source, always: every image and font the landing references exists and stays under its limit,
// nothing it references weighs a megabyte, no video plays or loads by itself, and the page asks the server
// for nothing (its CMS content is in the prebuilt HTML). On the last build (pnpm build), when .next holds
// one: the scripts the prebuilt /accueil names, and those it preloads, gzipped as they are sent.
import { strict as assert } from 'node:assert';
import { existsSync, globSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

export const LIMITS = {
  hero: 80, image: 200, font: 60, file: 1024, // KB on disk, per file
  firstScreenScripts: 170, // KB gzip: the scripts the HTML names, which hydrate the header and the hero
  scriptsAtLoad: 200, // KB gzip: those plus the chunks it preloads (the sections below, still drawn by the server)
  firstLoad: 260, // KB gzip: HTML + stylesheets + scripts at load (images and fonts are counted above, per file)
};

const read = (path) => readFileSync(path, 'utf8');
const kb = (bytes) => Math.round(bytes / 1024);
let checks = 0;
const ok = (condition, message) => { assert.ok(condition, message); checks++; };

// The landing's files: its components and styles, the prebuilt page, and the base it sits on.
const sources = [
  ...globSync('features/landing/**/*.{ts,tsx,css}'), 'app/accueil/page.tsx', 'app/layout.tsx', 'app/base.css',
  ...[...read('app/base.css').matchAll(/@import "\.\.\/(styles\/[^"]+)"/g)].map((m) => m[1]),
];
const code = Object.fromEntries(sources.map((file) => [file, read(file)]));

// Files it references from public/: "/landing/…webp", url('/fonts/…woff2'), "/favicon.svg"…
const asset = /["'(](\/[\w./-]+\.(webp|avif|png|jpe?g|gif|svg|woff2?|ttf|otf|mp4|webm|mov|m4v))["')]/g;
const refs = new Map();
for (const [file, src] of Object.entries(code)) for (const m of src.matchAll(asset)) refs.set(m[1], file);
ok(refs.size > 10, 'the landing references its images and fonts');
const hero = [...read('features/landing/v6.tsx').slice(read('features/landing/v6.tsx').indexOf('function Hero(')).matchAll(/src="(\/[^"]+)"/g)].map((m) => m[1]);
ok(hero.length >= 2, 'the hero names its images');
for (const [ref, from] of refs) {
  const path = `public${ref}`;
  ok(existsSync(path), `${ref} (${from}) exists in public/`);
  const size = kb(statSync(path).size);
  const kind = /\.(woff2?|ttf|otf)$/.test(ref) ? 'font' : /\.(mp4|webm|mov|m4v)$/.test(ref) ? 'video' : hero.includes(ref) ? 'hero' : 'image';
  ok(kind !== 'video', `${ref} (${from}): no video file on the landing's first load`);
  ok(size <= LIMITS.file, `${ref} weighs ${size} KB, over ${LIMITS.file} KB`);
  const limit = LIMITS[kind];
  ok(size <= limit, `${ref} (${kind}) weighs ${size} KB, over its ${limit} KB limit`);
}
// Fonts in woff2 only; images in a modern format (or SVG).
for (const ref of refs.keys()) ok(/\.(woff2|webp|avif|svg)$/.test(ref), `${ref}: fonts in woff2, images in webp, avif or svg`);

// Video: never playing or loading by itself, never imported into the page's code.
for (const [file, src] of Object.entries(code)) {
  for (const tag of src.match(/<video\b[^>]*>/g) ?? []) {
    ok(!/\bautoPlay\b|\bautoplay\b/.test(tag), `${file}: a <video> without autoplay`);
    ok(/preload="none"/.test(tag), `${file}: a <video> with preload="none"`);
  }
  ok(!/import\s[^;]*\.(mp4|webm|mov|m4v)['"]/.test(src), `${file}: no video imported into the page's code`);
  // The CMS content (prices, banner, contact) is in the prebuilt HTML: no request for it from the page.
  ok(!/\/api\/site/.test(src) || file === 'features/landing/content.ts', `${file}: no request to /api/site from the page`);
}

// The build: what the prebuilt /accueil makes the phone download, gzipped as it is sent.
const html = '.next/server/app/accueil.html';
if (existsSync(html)) {
  const page = read(html);
  const gz = (path) => gzipSync(readFileSync(`.next/${path}`)).length;
  const sum = (paths) => paths.reduce((total, path) => total + gz(path), 0);
  const unique = (re) => [...new Set([...page.matchAll(re)].map((m) => m[1]))];
  const scripts = unique(/<script src="\/_next\/(static\/[^"]+\.js)"(?![^>]*noModule)/g);
  const preloads = unique(/<link rel="preload"[^>]*href="\/_next\/(static\/[^"]+\.js)"/g).filter((s) => !scripts.includes(s));
  const sheets = unique(/<link rel="stylesheet" href="\/_next\/(static\/[^"]+\.css)"/g);
  ok(scripts.length > 0 && sheets.length > 0, 'the build names the landing’s scripts and stylesheets');
  const first = kb(sum(scripts)), atLoad = kb(sum(scripts) + sum(preloads));
  const total = kb(gzipSync(page).length + sum(sheets) + sum(scripts) + sum(preloads));
  ok(first <= LIMITS.firstScreenScripts, `the first screen's scripts weigh ${first} KB, over the ${LIMITS.firstScreenScripts} KB budget`);
  ok(atLoad <= LIMITS.scriptsAtLoad, `the scripts loaded with the page weigh ${atLoad} KB, over the ${LIMITS.scriptsAtLoad} KB budget`);
  ok(total <= LIMITS.firstLoad, `the first load (HTML, styles, scripts) weighs ${total} KB, over the ${LIMITS.firstLoad} KB budget`);
  ok((page.match(/<link rel="preload"[^>]*as="font"/g) ?? []).length <= 1, 'at most one font preloaded (the hero’s)');
  console.log(`landing budget: first screen ${first} KB of scripts, ${atLoad} KB with the preloaded sections, first load ${total} KB (gzip)`);
} else console.log('landing budget: no build in .next, the build checks are skipped (run pnpm build)');

console.log(`landing budget: ${checks} checks passed`);
