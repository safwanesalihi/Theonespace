// The public home stays light (app/accueil, next.config.ts, app/base.css): "/" without a session cookie
// is answered from the prebuilt page, under the very cookie names the sign-in sets; the public page and
// the root layout never pull the app's stylesheet; the app's screens all do; and the dictionaries stay
// out of the code every page loads.
import { strict as assert } from 'node:assert';
import { globSync, readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
let checks = 0;
const ok = (condition, message) => { assert.ok(condition, message); checks++; };

// The rewrite's cookies are the sign-in's cookies (lib/auth.ts, sessionCookieName).
const auth = read('lib/auth.ts').match(/sessionCookieName = \(secure: boolean\) => secure \? '([^']+)' : '([^']+)'/);
ok(auth, 'lib/auth.ts names its session cookies');
const config = read('next.config.ts');
const rewrite = config.match(/source: "\/", missing: \[(.*?)\], destination: "\/accueil"/);
ok(rewrite, 'next.config.ts answers "/" without a session from /accueil');
const keys = [...rewrite[1].matchAll(/key: "([^"]+)"/g)].map((m) => m[1]).sort();
assert.deepEqual(keys, [auth[1], auth[2]].sort(), 'the rewrite checks both session cookie names'); checks++;
ok(/source: "\/accueil", destination: "\/", permanent: true/.test(config), '/accueil is not an address of its own');
ok(/export const dynamic = "force-static"/.test(read('app/accueil/page.tsx')), 'the public page is prebuilt');

// The public page's stylesheets: the base and its own, never the app's.
const styles = /styles\.css['"]/;
ok(!styles.test(read('app/layout.tsx')) && /import "\.\/base\.css"/.test(read('app/layout.tsx')), 'the root layout carries only app/base.css');
const base = [...read('app/base.css').matchAll(/@import "([^"]+)"/g)].map((m) => m[1]);
assert.deepEqual(base, ['tailwindcss/preflight.css', '../styles/design-tokens.css', '../styles/fonts.css', '../styles/moments.css'], 'app/base.css stays small: the reset, the tokens, the Arabic face, the stamp'); checks++;
for (const file of ['app/accueil/page.tsx', ...globSync('features/landing/**/*.{ts,tsx,css}')]) ok(!styles.test(read(file)), `${file} does not pull the app's stylesheet`);
// The root's own screens wrap every page, the public one too: they bring only the boot screen.
for (const file of ['app/loading.tsx', 'app/error.tsx', 'app/not-found.tsx']) ok(!styles.test(read(file)) && /import '\.\/boot\.css'/.test(read(file)), `${file} brings app/boot.css, not the app's stylesheet`);
ok(/^@layer boot \{/m.test(read('app/boot.css')), 'the boot screen sits in a layer, under the app’s own rules');
// Every other screen brings it: the studio and the routes.
for (const file of ['app/_home/studio.tsx', 'app/login/page.tsx', 'app/conditions/page.tsx', 'app/confidentialite/page.tsx', 'app/suppression-des-donnees/page.tsx', 'app/admin/finance/page.tsx', 'app/plan-editorial/print/page.tsx']) ok(styles.test(read(file)), `${file} loads the app's stylesheet`);
ok(!/features\/studio/.test(read('app/_home/home.tsx').replace('./studio', '')), 'the home reaches the studio only through its own bundle');

// The dictionaries are fetched on demand, not imported by the code every page loads.
const index = read('lib/i18n/index.ts');
ok(!/^import .*(catalog|pipeline|drive|dictionaries)/m.test(index), 'lib/i18n/index.ts imports no dictionary');
ok(/import\('\.\/dictionaries'\)/.test(index), 'lib/i18n/index.ts fetches the dictionaries on demand');
ok(!/^import .*(catalog|dictionaries)/m.test(read('lib/i18n/locale-provider.tsx')), 'the provider imports no dictionary');

console.log(`public home: ${checks} checks passed`);
