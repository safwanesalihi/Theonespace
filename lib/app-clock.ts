// The server supplies UTC instants. A device's clock and timezone never decide the studio's time.
let anchor: { utc: number; tick: number; latency: number } | null = null;
const tick = () => performance.now();

export const appNowMs = () => anchor ? anchor.utc + tick() - anchor.tick : Date.now();
export const appNow = () => new Date(appNowMs());

/** Use a fresh response, including a 304, to align the clock. Prefer the quickest recent sample. */
export function syncServerClock(headers: Headers, started: number) {
  const sent = headers.get('X-Server-Time');
  if (!sent) return;
  const utc = Date.parse(sent), received = tick(), latency = received - started;
  if (!Number.isFinite(utc) || latency < 0 || latency > 30000) return;
  const estimated = utc + latency / 2;
  // Some browsers pause their monotonic clock during sleep. A fresh server response wins on wake.
  if (anchor && received - anchor.tick < 300000 && latency > anchor.latency && Math.abs(estimated - appNowMs()) < 2000) return;
  anchor = { utc: estimated, tick: received, latency };
}
