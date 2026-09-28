// Repeating social posts: a scheduled post with a `repeat` rule is a series. It is never published
// itself; each time its date and time come, the scheduled run publishes a copy of it for that day
// (an ordinary post, `repeatOf` the series, so statistics and reports work as for any post) and moves
// the series to its next date. Pure: no database or network here (the run is in
// app/api/editorial/publish-due, lib/editorial-repeat.ts).
import { dayIn, shiftDay } from '@/lib/flow';
import { meetingStart } from '@/lib/meetings';
import type { RecordItem } from '@/lib/model';

export type RepeatEvery = 'day' | 'week' | 'month';
/** `days`: weekdays (0 = Sunday) for 'week'; `monthDay`: 1–31 for 'month'; `until`: last day, inclusive. */
export type PostRepeat = { every: RepeatEvery; days?: number[]; monthDay?: number; until?: string };

export const repeatRules = {
  graceHours: 6,     // an occurrence the run reaches late (downtime) still goes out this long after its time
  horizonDays: 400,  // how far ahead the next date is looked for
};

const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
const monthDayOf = (day: string) => Number(day.slice(8, 10));
const lastDayOfMonth = (day: string) => new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0)).getUTCDate();

/** The rule as saved: weekdays default to the start date's, the day of the month to the start date's. */
export function normalizeRepeat(repeat: PostRepeat | null | undefined, start: string): PostRepeat | undefined {
  if (!repeat) return undefined;
  const until = repeat.until && repeat.until >= start ? repeat.until : undefined;
  if (repeat.every === 'week') {
    const days = [...new Set((repeat.days ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
    return { every: 'week', days: days.length ? days : [weekday(start)], ...(until ? { until } : {}) };
  }
  if (repeat.every === 'month') {
    const monthDay = Number.isInteger(repeat.monthDay) && repeat.monthDay! >= 1 && repeat.monthDay! <= 31 ? repeat.monthDay! : monthDayOf(start);
    return { every: 'month', monthDay, ...(until ? { until } : {}) };
  }
  return { every: 'day', ...(until ? { until } : {}) };
}

/** Whether the series goes out on this day (the 31st falls on a shorter month's last day). */
export function repeatsOn(repeat: PostRepeat, day: string) {
  if (repeat.until && day > repeat.until) return false;
  if (repeat.every === 'week') return (repeat.days ?? []).includes(weekday(day));
  if (repeat.every === 'month') return monthDayOf(day) === Math.min(repeat.monthDay ?? 1, lastDayOfMonth(day));
  return true;
}

/** The first day on or after `from` the series goes out, or null once it has ended. */
export function nextRepeatDay(repeat: PostRepeat, from: string): string | null {
  for (let i = 0, day = from; i <= repeatRules.horizonDays; i++, day = shiftDay(day, 1)) {
    if (repeat.until && day > repeat.until) return null;
    if (repeatsOn(repeat, day)) return day;
  }
  return null;
}

/** Days between the series' date and now that it went out on (its own date included), oldest first. */
function daysDue(repeat: PostRepeat, from: string, today: string) {
  const out: string[] = [];
  for (let day: string | null = from; day && day <= today && out.length < repeatRules.horizonDays; day = nextRepeatDay(repeat, shiftDay(day, 1))) {
    if (repeatsOn(repeat, day)) out.push(day);
  }
  return out;
}

export type SeriesStep = {
  publish: string | null;  // the day whose copy goes out now, if any
  skipped: string[];       // days missed by more than the grace period: not published late
  next: string | null;     // where the series moves to (null: it has ended)
};

/**
 * What the run does with a series whose time has come: the latest day that is due goes out (if it is
 * less than `graceHours` late), older missed days are skipped rather than posted in a burst, and the
 * series moves to the next day after them. Null when nothing is due yet.
 */
export function seriesStep(series: Pick<RecordItem, 'due' | 'time' | 'repeat'>, now: Date): SeriesStep | null {
  const repeat = series.repeat;
  if (!repeat || !series.due) return null;
  const time = series.time || '09:00';
  const at = (day: string) => meetingStart({ due: day, time })?.getTime() ?? Infinity;
  const due = daysDue(repeat, series.due, dayIn(now)).filter((day) => at(day) <= now.getTime());
  if (!due.length) return null;
  const last = due[due.length - 1];
  const onTime = now.getTime() - at(last) <= repeatRules.graceHours * 3_600_000;
  return {
    publish: onTime ? last : null,
    skipped: onTime ? due.slice(0, -1) : due,
    next: nextRepeatDay(repeat, shiftDay(last, 1)),
  };
}

const dayNames = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
/**
 * « Tous les jours », « Chaque lundi et jeudi », « Le 15 de chaque mois »: a French template and its
 * values; `tr` translates the day names before they are joined.
 */
export function repeatLabel(repeat: PostRepeat, tr: (s: string) => string = (s) => s): [string, Record<string, string | number>?] {
  if (repeat.every === 'week') {
    const days = [...(repeat.days ?? [])].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)); // Monday first
    if (days.length === 7) return ['Tous les jours'];
    const names = days.map((d) => tr(dayNames[d]));
    return names.length === 1 ? ['Chaque {day}', { day: names[0] }] : ['Chaque {days} et {last}', { days: names.slice(0, -1).join(', '), last: names[names.length - 1] }];
  }
  if (repeat.every === 'month') return ['Le {n} de chaque mois', { n: repeat.monthDay ?? 1 }];
  return ['Tous les jours'];
}

// ---------------------------------------------------------------- one date of a series
// A series can have one of its dates skipped, or published with its own title and text (the photos,
// networks and time stay the series'). Kept on the series by day, until that day has gone by.

export type SeriesException = { skip?: boolean; name?: string; description?: string };

/** What goes out on `day`: null when that date is skipped, else the title and text for it. */
export function seriesDay(series: Pick<RecordItem, 'name' | 'description' | 'repeatExceptions'>, day: string): { name: string; description: string; changed: boolean } | null {
  const ex = series.repeatExceptions?.[day];
  if (ex?.skip) return null;
  const name = ex?.name ?? series.name, description = ex?.description ?? series.description ?? '';
  return { name, description, changed: !!ex && (ex.name !== undefined || ex.description !== undefined) };
}

/** The exceptions still ahead of `after` (the day just handled). */
export function exceptionsAfter(exceptions: RecordItem['repeatExceptions'], after: string) {
  return Object.fromEntries(Object.entries(exceptions ?? {}).filter(([day]) => day > after));
}
