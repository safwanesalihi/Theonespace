/** Safari and embedded browsers may still expose only the legacy MediaQueryList listener. */
export function watchMediaQuery(query: MediaQueryList, listener: () => void) {
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }
  query.addListener(listener);
  return () => query.removeListener(listener);
}
