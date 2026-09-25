// Activity rules, shared by the browser (beat, report page) and the server (lib/activity.ts): the
// settings, the stored shape, and the pure arithmetic. No database access here.
export const activity = {
  beatSeconds: 60,      // the browser's beat interval
  idleMinutes: 5,       // no input for this long: still on screen, no longer active
  gapMinutes: 5,        // beats further apart than this start a new session
  creditCapSeconds: 90, // the most one beat can add, whatever the gap
  onlineMinutes: 2,     // last beat within this: shown as online
  keepDays: 180,        // older days are deleted when the report is read
};

export type ActivitySession = { start: string; end: string; active: number }; // `active` in seconds
export type ActivityDay = { userId: string; day: string; sessions: ActivitySession[] };

/** Pure: the day's record after one beat at `now`. */
export function applyBeat(current: ActivityDay | null, userId: string, day: string, now: Date, active: boolean): ActivityDay {
  const at = now.toISOString();
  const sessions = current ? current.sessions.map((s) => ({ ...s })) : [];
  const last = sessions.at(-1);
  const since = last ? (now.getTime() - Date.parse(last.end)) / 1000 : Infinity;
  if (!last || since > activity.gapMinutes * 60 || since < 0) {
    sessions.push({ start: at, end: at, active: 0 });
  } else {
    if (active) last.active += Math.round(Math.min(since, activity.creditCapSeconds));
    last.end = at;
  }
  return { userId, day, sessions };
}

export const onScreenSeconds = (day: ActivityDay) =>
  day.sessions.reduce((sum, s) => sum + Math.max(0, (Date.parse(s.end) - Date.parse(s.start)) / 1000), 0);
export const activeSeconds = (day: ActivityDay) => day.sessions.reduce((sum, s) => sum + s.active, 0);
