'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { backDistance, nextEntry, parseRoute, routeHash, type NavigationEntry, type WorkspaceRoute } from '@/lib/navigation';

const stateKey = 'oneCoreNavigation';
const newKey = () => crypto.randomUUID();
const scrollTo = (top: number) => {
  window.scrollTo({ top, behavior: 'instant' });
  document.querySelector('main.workspace')?.scrollTo({ top, behavior: 'instant' });
};
const scrollPosition = () => Math.max(window.scrollY, document.querySelector('main.workspace')?.scrollTop || 0);

/** Keeps the originating screen, filters and scroll in each browser history entry. */
export function useWorkspaceNavigation<T>({ workspaceId, view, defaultView, restoreView }: {
  workspaceId: string | null; view: T; defaultView: T; restoreView: (view: T) => void;
}) {
  const [route, setRoute] = useState<WorkspaceRoute>({ page: 'home' });
  const latest = useRef({ view, defaultView, restoreView });
  const active = useRef<NavigationEntry<T> | null>(null);
  useEffect(() => { latest.current = { view, defaultView, restoreView }; });
  const write = useCallback((entry: NavigationEntry<T>, push = false) => {
    const state = { ...window.history.state, [stateKey]: entry };
    if (push) window.history.pushState(state, '', routeHash(entry.route));
    else window.history.replaceState(state, '', window.location.href);
    active.current = entry;
  }, []);

  useEffect(() => {
    const read = () => {
      const parsed = parseRoute(window.location.hash);
      // Membership arrives asynchronously. Do not erase a saved origin during that first load.
      if (!workspaceId) { active.current = null; setRoute(parsed); return; }
      const saved = window.history.state?.[stateKey] as NavigationEntry<T> | undefined;
      const entry = saved && saved.workspaceId === workspaceId && routeHash(saved.route) === routeHash(parsed)
        ? saved : { key: newKey(), workspaceId, route: parsed, view: latest.current.defaultView, scroll: 0, trail: [] };
      write(entry);
      setRoute(entry.route);
      latest.current.restoreView(entry.view);
      requestAnimationFrame(() => scrollTo(entry.scroll));
    };
    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    read();
    window.addEventListener('popstate', read);
    window.addEventListener('hashchange', read);
    return () => {
      window.removeEventListener('popstate', read);
      window.removeEventListener('hashchange', read);
      window.history.scrollRestoration = previousScrollRestoration;
    };
  }, [workspaceId, write]);

  useEffect(() => {
    if (active.current && routeHash(active.current.route) === routeHash(route)) {
      write({ ...active.current, view });
    }
  }, [view, route, write]);

  const navigate = useCallback((target: WorkspaceRoute) => {
    const current = active.current;
    if (!current || routeHash(current.route) === routeHash(target)) return;
    const saved = { ...current, view: latest.current.view, scroll: scrollPosition() };
    write(saved);
    const entry = nextEntry(saved, target, latest.current.defaultView, newKey());
    write(entry, true);
    setRoute(target);
    latest.current.restoreView(entry.view);
    scrollTo(0);
  }, [write]);

  const goBack = useCallback((fallback: WorkspaceRoute, matches?: (route: WorkspaceRoute) => boolean) => {
    const current = active.current;
    const distance = current ? backDistance(current, matches) : 0;
    if (distance) {
      // Keep the current screen as well, so browser Forward restores it correctly.
      write({ ...current!, view: latest.current.view, scroll: scrollPosition() });
      window.history.go(-distance);
    } else navigate(fallback);
  }, [navigate, write]);

  return { route, navigate, goBack };
}
