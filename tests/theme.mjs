import { strict as assert } from 'node:assert';
import { readFileSync, globSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const postcss = (await import(pathToFileURL(globSync('node_modules/.pnpm/postcss@*/node_modules/postcss/lib/postcss.mjs')[0]))).default;
const tokens = postcss.parse(readFileSync('app/tokens.css', 'utf8'));
const theme = postcss.parse(readFileSync('app/theme.css', 'utf8'));
const base = {};
tokens.walkRules(':root', rule => rule.walkDecls(/^--/, d => { base[d.prop] = d.value; }));
const light = { ...base };
theme.walkRules(':root', rule => { if (rule.parent.params === 'screen') rule.walkDecls(/^--/, d => { light[d.prop] = d.value; }); });
const dark = { ...light };
theme.walkRules(':root[data-theme=dark]', rule => rule.walkDecls(/^--/, d => { dark[d.prop] = d.value; }));
function color(value, palette) {
  if (value.startsWith('var(')) return color(palette[value.slice(4, -1)], palette);
  if (/^#[\da-f]{3}$/i.test(value)) value = '#' + value.slice(1).split('').map(c => c + c).join('');
  assert.match(value, /^#[\da-f]{6}([\da-f]{2})?$/i, `Unsupported test color: ${value}`);
  return [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16)).concat(value.length === 9 ? parseInt(value.slice(7), 16) / 255 : 1);
}
const blend = (a, b) => a.slice(0, 3).map((v, i) => v * a[3] + b[i] * (1 - a[3])).concat(1);
const luminance = c => c.slice(0, 3).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [.2126, .7152, .0722][i], 0);
function ratio(fg, bg) { const a = luminance(fg), b = luminance(bg); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); }
let checks = 0;
for (const [name, palette] of Object.entries({ light, dark })) {
  for (const surface of ['page', 'surface', 'surface-sunken', 'brand-tint']) {
    const bg = blend(color(palette[`--t-${surface}`], palette), color(palette['--t-surface'], palette));
    for (const text of ['text', 'text-body', 'text-muted', 'brand-text', 'danger', 'success', 'info', 'purple']) {
      const contrast = ratio(color(palette[`--t-${text}`], palette), bg);
      assert.ok(contrast >= 4.5, `${name}: ${text} on ${surface} is ${contrast.toFixed(2)}:1`);
      checks++;
    }
  }
  for (const state of ['todo', 'doing', 'review', 'done', 'paused']) {
    const contrast = ratio(color(palette[`--t-${state}-ink`], palette), color(palette[`--t-${state}-bg`], palette));
    assert.ok(contrast >= 4.5, `${name}: ${state} status is ${contrast.toFixed(2)}:1`);
    checks++;
  }
  for (const state of ['success', 'info', 'purple', 'danger']) {
    assert.ok(ratio(color(palette[`--t-${state}`], palette), color(palette[`--t-${state}-bg`], palette)) >= 4.5, `${name}: ${state} message contrast`);
    checks++;
  }
  for (const stop of palette['--gold-metal'].match(/#[\da-f]{6}/ig)) {
    assert.ok(ratio(color(palette['--t-brand-ink'], palette), color(stop, palette)) >= 4.5, `${name}: text on gold gradient stop ${stop}`);
    checks++;
  }
  for (const surface of ['brand', 'brand-strong']) {
    assert.ok(ratio(color(palette['--t-brand-ink'], palette), color(palette[`--t-${surface}`], palette)) >= 4.5, `${name}: solid gold button ${surface}`);
    checks++;
  }
  assert.ok(ratio(color('#ffffff', palette), color(palette['--t-danger-solid'], palette)) >= 4.5, `${name}: destructive button`);
  checks++;
}
// A broad !important heading rule previously overrode every themed card, preview and auth panel.
const globals = postcss.parse(readFileSync('app/globals.css', 'utf8'));
globals.walkRules(rule => {
  if (rule.selector.split(',').some(s => /^(h[123]|strong)$/.test(s.trim()))) {
    rule.walkDecls('color', d => assert.ok(!d.important, `Global ${rule.selector} must allow local foregrounds`));
  }
});
// Public pages stay light even when the workspace preference is dark.
const landing = postcss.parse(readFileSync('app/landing.css', 'utf8'));
const publicPalette = {};
landing.walkRules('.os', rule => rule.walkDecls(/^--/, d => { publicPalette[d.prop] = d.value; }));
assert.ok(ratio(color(publicPalette['--os-gold-deep'], publicPalette), color(publicPalette['--os-gold-tint'], publicPalette)) >= 4.5, 'Public gold labels');
checks++;
landing.walkRules('.os-numbers .n4 .os-num', rule => {
  const styles = {};
  rule.walkDecls(d => { styles[d.prop] = d.value; });
  for (const stop of styles.background.match(/#[\da-f]{6}/ig)) {
    assert.ok(ratio(color(styles.color, publicPalette), color(stop, publicPalette)) >= 3, 'Public large gold metric');
    checks++;
  }
});
console.log(`Theme checks passed: ${checks} contrast pairs across light/dark text, surfaces, status badges, messages and gold gradients.`);
