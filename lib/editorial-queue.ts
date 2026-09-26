// Which social posts the scheduled run should publish now. Pure: callers feed it rows and a clock.
import { dayIn, flow, shiftDay } from '@/lib/flow';
import type { RecordItem } from '@/lib/model';
import { autoNetworks, awaitingClient, targetsOf, type SocialTarget } from '@/lib/social';

export const queue = {
  lookbackDays: 3,        // a post the scheduler missed (downtime, approval given late) is still picked up for this long
  retryAfterMinutes: 60,  // after a network error, wait this long before trying that network again
};

export function timeIn(date: Date, timeZone = flow.timeZone) {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

/** Targets of this post still to do: not published yet, and not failed too recently to retry. */
export function remainingTargets(post: RecordItem, now: Date, { ignoreRetryDelay = false, platforms = [] as RecordItem[] } = {}): SocialTarget[] {
  return targetsOf(post, platforms).filter((target) => {
    const last = post.publishResults?.[target.network];
    if (!last) return true;
    if (last.ok) return false;
    if (last.pending) return true;
    return ignoreRetryDelay || now.getTime() - Date.parse(last.at) >= queue.retryAfterMinutes * 60_000;
  });
}

/**
 * Posts to publish now: scheduled (never a draft), approved by the client when that client approves
 * posts, their date and time come (Casablanca) — or already being processed by Instagram — and with a
 * network the app posts to itself still to do.
 */
export function duePosts(records: RecordItem[], now: Date): RecordItem[] {
  const today = dayIn(now), clock = timeIn(now), oldest = shiftDay(today, -queue.lookbackDays);
  const clients = new Map(records.filter((r) => r.kind === 'client').map((r) => [r.id, r]));
  const platforms = records.filter((r) => r.kind === 'platform');
  return records.filter((post) => {
    if (post.kind !== 'editorial_post' || post.archived || post.publishedAt) return false;
    const client = post.clientId ? clients.get(post.clientId) : undefined;
    if (client?.archived) return false;
    const processing = Object.values(post.publishResults || {}).some((r) => r.pending);
    if (!processing) {
      if (post.socialState !== 'scheduled' || awaitingClient(post, client)) return false;
      if (!post.due || post.due > today || post.due < oldest) return false;
      if (post.due === today && (post.time || '09:00') > clock) return false;
    }
    return remainingTargets(post, now, { platforms }).some((t) => autoNetworks.includes(t.network));
  });
}
