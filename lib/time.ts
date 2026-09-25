// Time-tracking arithmetic, shared by the task page's breakdown and the dashboard's time panel.
// A task's clock is a list of spans per person; a span with no `end` is still running.
import type { RecordItem } from '@/lib/model';

export type TimeEntry = NonNullable<RecordItem['timeEntries']>[number];

/** "2h05", "45 min", "< 1 min" — for totals. */
export function formatDuration(ms: number) {
  const totalMinutes = Math.round(ms / 60000);
  const h = Math.floor(totalMinutes / 60),
    m = totalMinutes % 60;
  if (h === 0 && m === 0) return '< 1 min';
  return h > 0 ? `${h}h${m > 0 ? String(m).padStart(2, '0') : ''}` : `${m} min`;
}

/** "1:04:09" — a running clock, to the second. */
export function formatClock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** How much of a span falls inside [from, now]. A running span counts up to now. */
export function overlapMs(entry: TimeEntry, from: number, now: number) {
  const start = Math.max(Date.parse(entry.start), from);
  const end = Math.min(entry.end ? Date.parse(entry.end) : now, now);
  return Math.max(0, end - start);
}

export type Period = 'today' | 'week' | 'month';

/** Start of the period in the viewer's own clock: midnight, Monday midnight, the 1st at midnight. */
export function periodStart(period: Period, now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  if (period === 'month') d.setDate(1);
  return d.getTime();
}
