import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const esbuild = await import(pathToFileURL(globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0]));
mkdirSync('.sites-runtime', { recursive: true });
await esbuild.build({ entryPoints: ['lib/navigation.ts'], outfile: '.sites-runtime/navigation-test.mjs', bundle: true, platform: 'node', format: 'esm' });
const { routeHash, parseRoute, taskReturnRoute, nextEntry, backDistance } = await import(pathToFileURL(`${process.cwd()}/.sites-runtime/navigation-test.mjs`));
const route = { page: 'client', id: 'client / 1', tab: 'plan', detail: 'october-plan' };
assert.deepEqual(parseRoute(routeHash(route)), route, 'client and selected plan survive encoded links');
assert.deepEqual(parseRoute('#client/x/%E0%A4%A'), { page: 'client', id: 'x' }, 'malformed link cannot crash navigation');
assert.deepEqual(taskReturnRoute('internal'), { page: 'tasks', tab: 'internal' });
// Pages merged into others (docs/MENU-AUDIT.md §4, §11): old links and bookmarks land on the place that replaced them.
assert.deepEqual(parseRoute('#internal'), { page: 'tasks', tab: 'internal' }, '« Tâches internes » is Tâches filtered on « Interne »');
assert.deepEqual(parseRoute('#ig-search'), { page: 'ig', tab: 'search' }, '« Recherche Instagram » is the Instagram page’s search tab');
assert.deepEqual(parseRoute('#ig/nike'), { page: 'ig', id: 'nike' }, 'an account link still opens its analysis');
assert.deepEqual(parseRoute(routeHash({ page: 'tasks', tab: 'internal' })), { page: 'tasks', tab: 'internal' }, 'the filter survives its own link');
// The team, the clients and « Personnaliser » are categories of the one Settings page (features/studio/studio-settings.tsx).
assert.deepEqual(parseRoute('#team'), { page: 'settings', tab: 'team' }, 'an old link to the team opens its category in Settings');
assert.deepEqual(parseRoute('#team//invite'), { page: 'settings', tab: 'team', detail: 'invite' }, 'the invitation form keeps its place');
assert.deepEqual(parseRoute('#clients'), { page: 'settings', tab: 'clients' }, 'an old link to the clients opens their category in Settings');
assert.deepEqual(parseRoute('#customize'), { page: 'settings', tab: 'customize' }, 'an old link to Personnaliser opens its category in Settings');
assert.deepEqual(parseRoute('#client/x'), { page: 'client', id: 'x' }, 'a client keeps their own page');
// The agency settings' tabs of the previous version: « Processus » is « Personnaliser »; the agency's
// own parts open the agency category at that part (studio-settings.tsx reads them from the tab).
assert.deepEqual(parseRoute('#settings//process'), { page: 'settings', tab: 'customize' }, 'the old Processus tab is Personnaliser');
assert.deepEqual(parseRoute('#settings//team/invite'), { page: 'settings', tab: 'team', detail: 'invite' }, 'the old team tab with its invitation form');
for (const part of ['plan', 'brand', 'rules', 'drive']) assert.deepEqual(parseRoute(`#settings//${part}`), { page: 'settings', tab: part }, `#settings//${part} keeps its part for the agency category`);
assert.deepEqual(taskReturnRoute('client1'), { page: 'client', id: 'client1', tab: 'tasks' });
assert.deepEqual(taskReturnRoute(), { page: 'tasks' });
const filters = { query: 'launch', quick: 'review', view: 'calendar', month: '2026-11', sort: 'name' };
const source = { key: 'a', route: { page: 'client', id: 'client1', tab: 'tasks' }, workspaceId: 'workspace1', view: filters, scroll: 430, trail: [] };
const task = nextEntry(source, { page: 'task', id: 'task1' }, {}, 'b');
assert.equal(backDistance(task), 1);
assert.deepEqual(task.trail[0].route, source.route);
assert.deepEqual(task.trail[0].view, filters, 'return restores filters and calendar position');
assert.equal(task.trail[0].scroll, 430, 'return restores scroll position');
const portal = nextEntry(source, { page: 'portal', id: 'client1', tab: 'home' }, {}, 'c');
const portalTasks = nextEntry(portal, { page: 'portal', id: 'client1', tab: 'tasks' }, {}, 'd');
const review = nextEntry(portalTasks, { page: 'review', id: 'task1' }, {}, 'e');
assert.equal(backDistance(review), 1, 'review returns to the actual portal source');
assert.equal(backDistance(review, r => r.page !== 'portal' && r.page !== 'review'), 3, 'leave preview returns to the original studio screen');
assert.equal(backDistance(source), 0, 'direct links use a safe fallback rather than leaving the app');
assert.equal(backDistance(review, r => r.page === 'missing'), 0);
let deep = source;
for (let i = 0; i < 100; i++) deep = nextEntry(deep, { page: 'task', id: String(i) }, {}, String(i));
assert.equal(deep.trail.length, 32, 'history metadata stays bounded');
console.log('Navigation checks passed: scoped tasks, deep links, encoded plans, filters, scroll, nested portal returns and bounded history.');
