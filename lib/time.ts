/** Instants use the studio clock, independent of the browser or server timezone.
 * Calendar day keys have no timezone and must never move to the previous day. */
import { casablancaRange, casablancaTransitions } from '@/lib/casablanca-offsets';
import { appNow } from '@/lib/app-clock';
export { appNow, appNowMs } from '@/lib/app-clock';
export const appTimeZone = 'Africa/Casablanca';

/** Legacy UTC timestamps without an offset must not be interpreted in the device's timezone. */
export function timestampDate(value: string | Date): Date {
  if (typeof value !== 'string') return value;
  const iso = value.replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T').replace(/^(\d{4}-\d{2}-\d{2}T.*)([+-]\d{2})$/, '$1$2:00');
  return new Date(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(iso) ? iso + 'Z' : iso);
}

export function appOffsetSeconds(date: Date): number {
  const seconds = date.getTime() / 1000;
  if (seconds >= casablancaRange[0] && seconds < casablancaRange[1]) {
    let low = 0, high = casablancaTransitions.length;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (casablancaTransitions[middle][0] <= seconds) low = middle; else high = middle;
    }
    return casablancaTransitions[low][1];
  }
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: appTimeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(p => [p.type, p.value]));
  return (Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)) - Math.floor(date.getTime() / 1000) * 1000) / 1000;
}

/** A time shown in the studio clock: Casablanca, whatever the device says. */
function casablancaFormat(value: string | Date, locale: string, options: Intl.DateTimeFormatOptions = {}) {
  const date = timestampDate(value);
  if (Number.isNaN(date.valueOf())) return '';
  // Localize the Casablanca wall clock in UTC so stale browser tzdata cannot change its offset.
  const local = new Date(date.getTime() + appOffsetSeconds(date) * 1000);
  return new Intl.DateTimeFormat(locale, { ...options, hourCycle: 'h23', timeZone: 'UTC' }).format(local);
}

// A client reads times on their own clock (the studio keeps Casablanca's): the portal sets the device's
// zone here. Business days and deadlines (appDayKey, appWallTime…) always stay on Casablanca.
let displayZone: string | undefined;
/** Shows every displayed time in `zone` (an IANA name); undefined goes back to Casablanca. Browser only. */
export function setDisplayTimeZone(zone?: string) {
  if (typeof window === 'undefined') return;
  try { if (zone) new Intl.DateTimeFormat('en', { timeZone: zone }); displayZone = zone || undefined; } catch { displayZone = undefined; }
}
export const deviceTimeZone = () => (typeof window === 'undefined' ? undefined : Intl.DateTimeFormat().resolvedOptions().timeZone);
/** The zone's short name next to a time: « Casablanca », or the device's (GMT, GMT+1…). */
export function timeZoneLabel(value: string | Date) {
  if (!displayZone) return 'Casablanca';
  const date = timestampDate(value);
  if (Number.isNaN(date.valueOf())) return displayZone;
  return new Intl.DateTimeFormat('en', { timeZone: displayZone, timeZoneName: 'short' }).formatToParts(date).find((p) => p.type === 'timeZoneName')?.value ?? displayZone;
}

export function formatTimestamp(value: string | Date, locale: string, options: Intl.DateTimeFormatOptions = {}) {
  if (!displayZone) return casablancaFormat(value, locale, options);
  const date = timestampDate(value);
  if (Number.isNaN(date.valueOf())) return '';
  return new Intl.DateTimeFormat(locale, { ...options, hourCycle: 'h23', timeZone: displayZone }).format(date);
}

export function formatAppDate(value: string, locale: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T12:00:00Z`);
    if (Number.isNaN(date.valueOf())) return '';
    return new Intl.DateTimeFormat(locale, { ...options, hourCycle: 'h23', timeZone: 'UTC' }).format(date);
  }
  return formatTimestamp(value, locale, options);
}

export const appDayKey = (value: string | Date) => casablancaFormat(value, 'en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' });
/** The calendar day as the reader's own clock shows it (for grouping a chat by day). */
export const displayDayKey = (value: string | Date) => formatTimestamp(value, 'en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' });

/** A calendar's wall-clock date; local Date arithmetic is safe after choosing Casablanca's day. */
export function appCalendarNow() {
  const [year, month, day] = appDayKey(appNow()).split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

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


/** A Casablanca wall-clock value → an instant, without parsing locale text in the device zone. */
export function appWallTime(day: string, time = '00:00'): Date {
  const [year, month, date] = day.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const wanted = Date.UTC(year, month - 1, date, hour, minute);
  let instant = wanted;
  for (let i = 0; i < 3; i++) {
    const represented = instant + appOffsetSeconds(new Date(instant)) * 1000;
    const difference = wanted - represented;
    if (!difference) break;
    instant += difference;
  }
  return new Date(instant);
}

/** Period boundaries follow Casablanca, just like the timestamps shown alongside them. */
export function periodStart(period: Period, now = appNow()) {
  const date = new Date(`${appDayKey(now)}T12:00:00Z`);
  if (period === 'week') date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  if (period === 'month') date.setUTCDate(1);
  return appWallTime(date.toISOString().slice(0, 10)).getTime();
}
