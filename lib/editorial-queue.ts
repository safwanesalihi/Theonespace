// Which editorial posts the n8n automation should publish now. Pure: the route feeds it rows and a clock.
import { dayIn, flow, shiftDay } from '@/lib/flow';
import type { RecordItem } from '@/lib/model';

export const queue = {
  lookbackDays: 3,        // a post the automation missed (downtime, late media) is still offered for this long
  retryAfterMinutes: 60,  // after a platform error, wait this long before offering the job again
};

export type PublishJob = {
  postId: string;
  workspaceId: string;
  platformId: string;
  platform: string;      // platform name as typed in the tracker, e.g. "Instagram"
  name: string;          // post title
  caption: string;       // post description, used as the caption / video description
  mediaUrl: string;
  due: string;
  time?: string;
  client: string;        // client name, or "Interne"
  revision: number;
  previousError?: string;
};

function timeIn(date: Date, timeZone = flow.timeZone) {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

export function dueJobs(records: RecordItem[], workspaceId: string, now: Date): PublishJob[] {
  const today = dayIn(now), clock = timeIn(now), oldest = shiftDay(today, -queue.lookbackDays);
  const platforms = new Map(records.filter((r) => r.kind === 'platform').map((r) => [r.id, r.name]));
  const clients = new Map(records.filter((r) => r.kind === 'client').map((r) => [r.id, r]));
  const jobs: PublishJob[] = [];
  for (const post of records) {
    if (post.kind !== 'editorial_post' || post.archived || post.publishedAt) continue;
    if (!post.due || post.due > today || post.due < oldest) continue;
    if (post.due === today && post.time && post.time > clock) continue;
    if (!post.mediaUrl || !post.channels?.length) continue;
    if (post.clientId !== 'internal' && clients.get(post.clientId || '')?.archived) continue;
    for (const platformId of post.channels) {
      const platform = platforms.get(platformId);
      if (!platform) continue;
      const last = post.publishResults?.[platformId];
      if (last?.ok) continue;
      if (last && now.getTime() - Date.parse(last.at) < queue.retryAfterMinutes * 60_000) continue;
      jobs.push({
        postId: post.id, workspaceId, platformId, platform, name: post.name, caption: post.description || '',
        mediaUrl: post.mediaUrl, due: post.due, time: post.time || undefined,
        client: post.clientId === 'internal' ? 'Interne' : clients.get(post.clientId || '')?.name || '',
        revision: post.revision, previousError: last?.error,
      });
    }
  }
  return jobs;
}
