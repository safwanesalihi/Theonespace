/** Hash routes and safe fallback destinations for the studio and client portal. */
export type WorkspaceRoute = { page: string; id?: string; tab?: string; detail?: string };
export function routeHash(route: WorkspaceRoute) {
  return '#' + [route.page, route.id || '', route.tab || '', route.detail || ''].map(encodeURIComponent).join('/').replace(/\/+$/, '');
}
export function parseRoute(hash: string): WorkspaceRoute {
  const [page, id, tab, detail] = hash.replace(/^#/, '').split('/').map((part) => { try { return decodeURIComponent(part); } catch { return ''; } });
  return currentRoute({ page: page || 'home', ...(id ? { id } : {}), ...(tab ? { tab } : {}), ...(detail ? { detail } : {}) });
}
/**
 * Pages merged into others (docs/MENU-AUDIT.md §4): an old link or bookmark lands on the tab that took
 * its place. « Tâches internes » is Tâches filtered on « Interne »; « Recherche Instagram » is the
 * Instagram page's search tab; « Personnaliser » is the « Processus » tab of the agency's settings.
 */
export function currentRoute(route: WorkspaceRoute): WorkspaceRoute {
  if (route.page === 'internal') return { page: 'tasks', tab: 'internal' };
  if (route.page === 'ig-search') return { page: 'ig', tab: 'search' };
  if (route.page === 'customize') return { page: 'settings', tab: 'process' };
  return route;
}
/** Tâches filtered on the agency's own work (client « Interne »). */
export const isInternalTasks = (route: WorkspaceRoute) => route.page === 'tasks' && route.tab === 'internal';
export function taskReturnRoute(clientId?: string): WorkspaceRoute {
  return clientId === 'internal' ? { page: 'tasks', tab: 'internal' } : clientId ? { page: 'client', id: clientId, tab: 'tasks' } : { page: 'tasks' };
}
export type NavigationVisit<T> = { key: string; route: WorkspaceRoute; view: T; scroll: number };
export type NavigationEntry<T> = NavigationVisit<T> & { workspaceId: string | null; trail: NavigationVisit<T>[] };
/** A bounded trail maps directly to browser history entries, including nested previews. */
export function nextEntry<T>(current: NavigationEntry<T>, route: WorkspaceRoute, view: T, key: string): NavigationEntry<T> {
  return { key, workspaceId: current.workspaceId, route, view, scroll: 0, trail: [...current.trail, { key: current.key, route: current.route, view: current.view, scroll: current.scroll }].slice(-32) };
}
export function backDistance<T>(entry: NavigationEntry<T>, matches?: (route: WorkspaceRoute) => boolean) {
  if (!matches) return entry.trail.length ? 1 : 0;
  const index = entry.trail.findLastIndex((visit) => matches(visit.route));
  return index < 0 ? 0 : entry.trail.length - index;
}
