// Which editorial posts the scheduled run should publish now. Pure: callers feed it rows and a clock.
import { dayIn, flow, shiftDay } from '@/lib/flow';
import type { RecordItem } from '@/lib/model';

export const queue = {
  lookbackDays: 3,        // a post the scheduler missed (downtime, media added late) is still picked up for this long
  retryAfterMinutes: 60,  // after a platform error, wait this long before trying that platform again
};

export function timeIn(date: Date, timeZone = flow.timeZone) {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

/** A post is ready to go out: it has something to publish and somewhere to publish it. */
export const publishable = (post: RecordItem) =>
  post.kind === 'editorial_post' && !post.archived && !!post.mediaUrl && !!post.mediaType && !!post.channels?.length;

/** Platforms of this post still to do: not published yet, and not failed too recently to retry. */
export function remainingPlatforms(post: RecordItem, now: Date, { ignoreRetryDelay = false } = {}) {
  return (post.channels || []).filter((platformId) => {
    const last = post.publishResults?.[platformId];
    if (!last) return true;
    if (last.ok) return false;
    if (last.pending) return true;
    return ignoreRetryDelay || now.getTime() - Date.parse(last.at) >= queue.retryAfterMinutes * 60_000;
  });
}

/** Posts whose date (and time, in Casablanca) has come, or that Instagram is still processing. */
export function duePosts(records: RecordItem[], now: Date): RecordItem[] {
  const today = dayIn(now), clock = timeIn(now), oldest = shiftDay(today, -queue.lookbackDays);
  const archivedClients = new Set(records.filter((r) => r.kind === 'client' && r.archived).map((r) => r.id));
  return records.filter((post) => {
    if (!publishable(post) || post.publishedAt) return false;
    if (post.clientId && archivedClients.has(post.clientId)) return false;
    const processing = Object.values(post.publishResults || {}).some((r) => r.pending);
    if (!processing) {
      if (!post.due || post.due > today || post.due < oldest) return false;
      if (post.due === today && post.time && post.time > clock) return false;
    }
    return remainingPlatforms(post, now).length > 0;
  });
}
