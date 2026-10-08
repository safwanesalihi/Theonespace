import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// Resolve through the declared build dependency, independent of npm/pnpm/Bun layout.
const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
const tokens = postcss.parse(readFileSync('app/design-tokens.css', 'utf8'));
const theme = tokens;
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
    for (const network of ['instagram', 'facebook', 'tiktok', 'youtube']) {
      const contrast = ratio(color(palette[`--net-${network}-ink`], palette), bg);
      assert.ok(contrast >= 4.5, `${name}: ${network} icon on ${surface} is ${contrast.toFixed(2)}:1`);
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
  for (const priority of ['low', 'medium', 'high', 'urgent']) {
    assert.ok(ratio(color(palette[`--t-priority-${priority}-ink`], palette), color(palette[`--t-priority-${priority}-bg`], palette)) >= 4.5, `${name}: ${priority} priority`);
    checks++;
  }
  for (let i = 0; i < 7; i++) {
    assert.ok(ratio(color(palette[i >= 5 ? '--t-heat-light-ink' : '--t-heat-dark-ink'], palette), color(palette[`--t-heat-${i}`], palette)) >= 4.5, `${name}: heatmap level ${i}`);
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
// Chat has its own WhatsApp palette; validate actual message, timestamp, receipt and control colors.
const chatTheme = postcss.parse(readFileSync('app/theme.css', 'utf8'));
const chatLight = {}, chatDark = {};
chatTheme.walkRules('.task-chat', rule => rule.walkDecls(/^--chat-/, d => { chatLight[d.prop] = d.value; }));
chatTheme.walkRules('[data-theme=dark] .task-chat', rule => rule.walkDecls(/^--chat-/, d => { chatDark[d.prop] = d.value; }));
for (const [name, palette] of Object.entries({ light: chatLight, dark: { ...chatLight, ...chatDark } })) {
  for (const surface of ['mine', 'theirs', 'file', 'field', 'panel']) {
    for (const foreground of ['ink', 'meta']) {
      const contrast = ratio(color(palette[`--chat-${foreground}`], palette), color(palette[`--chat-${surface}`], palette));
      assert.ok(contrast >= 4.5, `Chat ${name}: ${foreground} on ${surface} is ${contrast.toFixed(2)}:1`); checks++;
    }
  }
  for (const foreground of ['read', 'played', 'wave']) {
    for (const surface of ['mine', 'theirs']) {
      const contrast = ratio(color(palette[`--chat-${foreground}`], palette), color(palette[`--chat-${surface}`], palette));
      assert.ok(contrast >= 3, `Chat ${name}: ${foreground} icon on ${surface} is ${contrast.toFixed(2)}:1`); checks++;
    }
  }
  assert.ok(ratio(color('#ffffff', palette), color(palette['--chat-accent'], palette)) >= 4.5, `Chat ${name}: send button`); checks++;
}
// A broad !important heading rule previously overrode every themed card, preview and auth panel.
function checkStyles(css, file) {
  postcss.parse(css).walkRules(rule => {
    const selectors = rule.selector.split(',').map(s => s.trim());
    if (selectors.some(s => /^(h[123]|strong)$/.test(s))) {
      rule.walkDecls('color', d => assert.ok(!d.important, `${file}: global ${rule.selector} must allow local foregrounds`));
    }
    // Completed, cancelled and recurring content remains readable and interactive.
    if (selectors.some(s => /^\.(meeting-card\.(over|cancelled)|portal-agenda section\.past|social-chip\.(published|repeat-(ahead|skipped))|print-void)$/.test(s)
      || ['.social-day-add', '.social-network-filter button', '.composer-preview-tabs button', '.post-card-networks button'].includes(s))) {
      rule.walkDecls('opacity', d => assert.ok(Number(d.value) >= 1, `${file}: ${rule.selector} fades informational content`));
    }
  });
}
assert.throws(() => checkStyles('h1,h2,h3,strong,.table-name{color:#0f172a!important}', 'old deployed CSS'), /must allow local foregrounds/);
assert.throws(() => checkStyles('.meeting-card.cancelled{opacity:.65}', 'faded meeting'), /fades informational content/);
function cssFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = `${directory}/${entry.name}`;
    return entry.isDirectory() ? cssFiles(file) : entry.name.endsWith('.css') ? [file] : [];
  });
}
// Every stylesheet the app ships: global (app/, styles/), per feature (features/) and vendored.
const styles = [...cssFiles('app'), ...cssFiles('styles'), ...cssFiles('features'), ...cssFiles('vendor')];
if (process.argv.includes('--compiled')) {
  const compiled = cssFiles('.next/static');
  assert.ok(compiled.length, 'Build CSS assets must exist before deployment checks');
  styles.push(...compiled);
}
for (const file of styles) checkStyles(readFileSync(file, 'utf8'), file);
// Public pages stay light even when the workspace preference is dark.
const landing = postcss.parse(readFileSync('features/landing/landing.css', 'utf8'));
const publicPalette = {};
landing.walkRules('.os', rule => rule.walkDecls(/^--/, d => { publicPalette[d.prop] = d.value; }));
const publicIconPalette = { ...dark, ...publicPalette };
for (const network of ['instagram', 'facebook', 'tiktok', 'youtube']) {
  for (const surface of ['bg', 'card', 'gold-tint']) {
    assert.ok(ratio(color(publicIconPalette[`--net-${network}-ink`], publicIconPalette), color(publicPalette[`--os-${surface}`], publicPalette)) >= 4.5, `Public ${network} icon on ${surface}, even with a dark workspace preference`);
    checks++;
  }
}
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
console.log(`Theme checks passed: ${checks} contrast pairs; ${styles.length} CSS files checked for heading overrides and faded content.`);
