// How often an open page asks the server for changes (features/workspace/use-workspace-session.ts).
// Every poll is a function call and a few database round trips, for every open tab: a person working keeps the
// 5 seconds, a tab left alone for a while slows down, and it catches up at once when its owner comes back.
// Pure: the thresholds are tested (tests/poll-delay.mjs).
export const pollDelays = { active: 5_000, quiet: 15_000, idle: 45_000 } as const;
/** Idle time after which a tab is « quiet », then « idle ». */
export const quietAfterMs = 30_000;
export const idleAfterMs = 300_000;

export const pollDelay = (idleMs: number) => (idleMs < quietAfterMs ? pollDelays.active : idleMs < idleAfterMs ? pollDelays.quiet : pollDelays.idle);
