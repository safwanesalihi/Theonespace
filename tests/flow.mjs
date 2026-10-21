// The One Flow rules, exercised without a database.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const esbuildPath = globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0] || 'node_modules/esbuild/lib/main.js';
const esbuild = await import(pathToFileURL(esbuildPath));
mkdirSync('.sites-runtime', { recursive: true });
await esbuild.build({ entryPoints: ['lib/flow.ts'], outfile: '.sites-runtime/flow-test.mjs', bundle: true, platform: 'node', format: 'esm',
  plugins: [{ name: 'alias', setup(b) { b.onResolve({ filter: /^@\/lib\/model$/ }, () => ({ path: process.cwd() + '/lib/model.ts' })); } }] });
const flowLib = await import(pathToFileURL(process.cwd() + '/.sites-runtime/flow-test.mjs'));
const { flow, courtOf, gatesFor, insideLock, lockApplies, sendForValidation, approve, requestChanges, publish, sweep, computeMetrics, clientPeriodWork, monthPeriod, portalView, shiftDay, dayIn, isEvergreenReserve, stopClocks, leftWorkAt, countsInMetrics, submitForReview, rejectInternally, clientTaskCopy } = flowLib;

let checks = 0;
const ok = (condition, message) => { assert.ok(condition, message); checks++; };
const eq = (a, b, message) => { assert.deepEqual(a, b, message); checks++; };

const today = '2026-09-14';
const at = (iso) => new Date(iso);
const task = (extra = {}) => ({ id: 't1', kind: 'task', revision: 1, name: 'Post', clientId: 'c1', projectId: 'p1', status: 'À faire', createdAt: '2026-09-01T09:00:00.000Z', ...extra });
const client = { id: 'c1', kind: 'client', revision: 1, name: 'Client', createdAt: '2026-09-01T09:00:00.000Z', quota: '4' };
const project = { id: 'p1', kind: 'project', revision: 1, name: 'Projet', clientId: 'c1', createdAt: '2026-09-01T09:00:00.000Z' };

// Court is derived, never typed.
eq(courtOf(task()), 'studio'); eq(courtOf(task({ status: 'À valider' })), 'client'); eq(courtOf(task({ status: 'Validé' })), 'studio');
eq(courtOf(task({ status: 'Validé', publishedAt: '2026-09-10T10:00:00.000Z' })), 'done'); eq(courtOf(task({ archived: true })), 'done');

// Four backward gates from the publish date.
const gates = gatesFor(task({ due: '2026-09-28', description: 'brief' }), today);
eq(gates.map((g) => g.day), ['2026-09-14', '2026-09-21', '2026-09-23', '2026-09-27']);
eq(gates.map((g) => g.reached), [true, false, false, false]);
ok(!gates.some((g) => g.late), 'nothing late two weeks out');
const late = gatesFor(task({ due: '2026-09-16', status: 'En cours' }), today);
ok(late.find((g) => g.key === 'send').late && late.find((g) => g.key === 'validation').late, 'send and validation gates are late two days before publishing');
eq(gatesFor(task(), today), [], 'no due, no gates');
eq(gatesFor(task({ due: '2026-09-28', publishable: false }), today), [], 'internal work has no gates');
ok(!isEvergreenReserve(task({ status: 'Validé', evergreen: true, publishable: false })), 'internal work is never evergreen reserve');
{
  const internal = sweep([client, project, task({ id: 'copy', status: 'En cours', due: shiftDay(dayIn(new Date('2026-09-16T11:00:00.000Z')), 1), publishable: false })], new Date('2026-09-16T11:00:00.000Z'));
  eq(internal.events, [], 'no J−1 / J−7 alerts for internal work');
}

// J−7 lock: only future dates inside the window, only when the date actually moves.
ok(insideLock('2026-09-20', today) && insideLock(today, today) && !insideLock('2026-09-21', today), 'window is today … J−7 exclusive');
ok(!insideLock('2026-09-10', today), 'past dates are backfills, not lock violations');
ok(lockApplies(undefined, '2026-09-18', today), 'creating inside the window is locked');
ok(!lockApplies('2026-09-18', '2026-09-18', today), 'keeping the same date is free');
ok(lockApplies('2026-09-30', '2026-09-18', today) && !lockApplies('2026-09-18', '2026-09-30', today), 'moving in is locked, moving out is free');

// Clock, rounds, sign-off.
const sent = sendForValidation(task({ status: 'En cours', deliverable: 'https://x.test/a.pdf' }), '2026-09-14T10:00:00.000Z');
eq(sent.status, 'À valider'); eq(sent.approvalDueAt, '2026-09-16T10:00:00.000Z', '48 h clock stored, never recomputed');
const round1 = requestChanges(sent, 'Client A', '2026-09-15T10:00:00.000Z');
eq([round1.status, round1.revisionRound, round1.approvalDueAt], ['En cours', 1, undefined]);
const round3 = requestChanges(requestChanges(round1, 'Client A', '2026-09-16T10:00:00.000Z'), 'Client A', '2026-09-17T10:00:00.000Z');
ok(round3.revisionRound === 3 && round3.history.at(-1).text.includes('hors forfait'), 'round 3 is flagged hors forfait');
const signed = approve(sent, { mode: 'explicit', by: 'Client A', email: 'a@client.test', at: '2026-09-15T08:00:00.000Z', round: 0 });
eq([signed.status, signed.validatedAt, signed.signOff.mode, signed.approvalDueAt], ['Validé', '2026-09-15T08:00:00.000Z', 'explicit', undefined]);
// A clock only runs while the task is « En cours »: every way out closes everyone's.
const clocks = [{ userId: 'y', name: 'Y', start: '2026-09-14T08:00:00.000Z' }, { userId: 'o', name: 'O', start: '2026-09-14T09:00:00.000Z', end: '2026-09-14T09:30:00.000Z' }];
const timed = task({ status: 'En cours', deliverable: 'https://x.test/a.pdf', timeEntries: clocks });
eq(sendForValidation(timed, '2026-09-14T10:00:00.000Z').timeEntries.map((e) => e.end), ['2026-09-14T10:00:00.000Z', '2026-09-14T09:30:00.000Z'], 'sending for validation stops the running clock, closed ones untouched');
const byClient = approve({ ...timed, status: 'À valider' }, { mode: 'explicit', by: 'Client A', at: '2026-09-15T08:00:00.000Z', round: 0 });
eq(byClient.timeEntries[0].end, '2026-09-15T08:00:00.000Z', 'a client approval stops it');
const silent = sweep([{ ...timed, status: 'À valider', approvalDueAt: '2026-09-16T10:00:00.000Z' }], new Date('2026-09-16T11:00:00.000Z')).tasks[0];
eq([silent.status, silent.timeEntries[0].end], ['Validé', '2026-09-16T10:00:00.000Z'], 'a silent approval stops it at the end of the 48 h');
eq(stopClocks(timed, '2026-09-14T07:00:00.000Z').timeEntries[0].end, '2026-09-14T08:00:00.000Z', 'a clock never ends before it started');
eq(leftWorkAt({ ...timed, sentAt: '2026-09-14T10:00:00.000Z', validatedAt: '2026-09-15T10:00:00.000Z' }, clocks[0].start, '2026-09-20T00:00:00.000Z'), '2026-09-14T10:00:00.000Z', 'a leftover clock ends when the task was sent');
eq(leftWorkAt({ ...timed, history: [{ text: 'x', date: '2026-09-14T12:00:00.000Z' }] }, clocks[0].start, '2026-09-20T00:00:00.000Z'), '2026-09-14T12:00:00.000Z', 'else at its latest change');
eq(leftWorkAt(timed, clocks[0].start, '2026-09-20T00:00:00.000Z'), clocks[0].start, 'else it counts nothing, rather than time nobody can vouch for');
const live = publish(signed, '2026-09-20T09:00:00.000Z', 'Studio');
eq(courtOf(live), 'done');
ok(isEvergreenReserve(task({ status: 'Validé', evergreen: true })) && !isEvergreenReserve(task({ status: 'Validé', evergreen: true, due: '2026-10-01' })), 'reserve = validated, undated, unpublished');

// The sweep: silence approves, reminders fire once, J−1 and J−7 alert, all idempotent.
const now = at('2026-09-16T11:00:00.000Z');
const records = [client, project,
  task({ id: 'due', status: 'À valider', sentAt: '2026-09-14T10:00:00.000Z', approvalDueAt: '2026-09-16T10:00:00.000Z', deliverable: 'https://x.test/a.pdf' }),
  task({ id: 'soon', status: 'À valider', sentAt: '2026-09-15T08:00:00.000Z', approvalDueAt: '2026-09-17T08:00:00.000Z', deliverable: 'https://x.test/b.pdf' }),
  task({ id: 'tomorrow', status: 'En cours', due: shiftDay(dayIn(now), 1) }),
  task({ id: 'locked', status: 'À faire', due: shiftDay(dayIn(now), 4) }),
  task({ id: 'fine', status: 'À faire', due: shiftDay(dayIn(now), 20) }),
  task({ id: 'archived', status: 'À valider', approvalDueAt: '2026-09-10T10:00:00.000Z', archived: true }),
];
const first = sweep(records, now);
const auto = first.tasks.find((t) => t.id === 'due');
eq([auto.status, auto.signOff.mode, auto.validatedAt], ['Validé', 'silence', '2026-09-16T10:00:00.000Z'], 'silence approves at the stored deadline');
const remindedSoon = first.tasks.find((t) => t.id === 'soon');
eq(remindedSoon.reminders, ['24h'], 'the 24 h reminder fires once, 6 h not yet');
ok(!first.tasks.some((t) => t.id === 'archived'), 'archived items are left alone');
eq(first.events.map((e) => e.type).sort(), ['auto-approved', 'lock', 'lock', 'reminder', 'sweep'], 'tomorrow is both a J−1 miss and inside the J−7 window');
ok(first.events.find((e) => e.type === 'sweep').taskId === 'tomorrow' && first.events.filter((e) => e.type === 'lock').map((e) => e.taskId).sort().join() === 'locked,tomorrow');
const applied = records.map((r) => first.tasks.find((t) => t.id === r.id) ?? r);
const second = sweep(applied, now);
eq([second.tasks.length, second.events.filter((e) => e.type !== 'sweep' && e.type !== 'lock').length], [0, 0], 'running again changes nothing');
eq(second.events.map((e) => e.id), first.events.filter((e) => e.type === 'sweep' || e.type === 'lock').map((e) => e.id), 'alert ids are deterministic so INSERT OR IGNORE dedupes them');

// Approved work archives itself 15 days after the approval, once its publication date has passed.
{
  const now = at('2026-10-20T10:00:00.000Z');
  const approvedOn = (days, extra = {}) => {
    const when = new Date(now.getTime() - days * 86_400_000).toISOString();
    return task({ status: 'Validé', validatedAt: when, signOff: { mode: 'explicit', by: 'A', at: when, round: 0 }, ...extra });
  };
  const set = [client, project,
    approvedOn(16, { id: 'old', due: '2026-10-05', publishedAt: '2026-10-05T09:00:00.000Z' }),
    approvedOn(14, { id: 'recent', due: '2026-10-05' }),
    approvedOn(15, { id: 'exactly' }),
    approvedOn(20, { id: 'upcoming', due: '2026-10-25' }),
    approvedOn(20, { id: 'today', due: dayIn(now) }),
    approvedOn(30, { id: 'reserve', evergreen: true }),
    approvedOn(30, { id: 'restored', due: '2026-09-25', autoArchivedAt: new Date(now.getTime() - 5 * 86_400_000).toISOString() }),
    approvedOn(16, { id: 'again', due: '2026-10-01', autoArchivedAt: new Date(now.getTime() - 40 * 86_400_000).toISOString() }),
    approvedOn(16, { id: 'running', timeEntries: [{ userId: 'u', name: 'U', start: '2026-10-20T09:00:00.000Z' }] }),
    task({ id: 'open', status: 'En cours', createdAt: '2026-08-01T09:00:00.000Z' }),
  ];
  const result = sweep(set, now);
  const archivedIds = result.tasks.filter((t) => t.archived).map((t) => t.id).sort();
  eq(archivedIds, ['again', 'exactly', 'old', 'running'], 'archived 15 days after approval; not before, not before its date, not the evergreen reserve, not a task restored by hand');
  const old = result.tasks.find((t) => t.id === 'old');
  eq([old.autoArchivedAt, old.history.at(-1).text], [now.toISOString(), 'Archivé automatiquement : validé depuis 15 jours'], 'stamped, and said in the history');
  ok(result.tasks.find((t) => t.id === 'running').timeEntries.every((e) => e.end), 'a clock left running is stopped');
  eq(result.events, [], 'archiving notifies nobody');
  const after = set.map((r) => result.tasks.find((t) => t.id === r.id) ?? r);
  eq(sweep(after, now).tasks.filter((t) => t.archived).length, 0, 'running again archives nothing more');
  // Delivered work still counts in the numbers once archived; work archived by hand does not.
  ok(countsInMetrics(old) && !countsInMetrics(task({ archived: true })), 'auto-archived work counts, hand-archived does not');
  eq(computeMetrics(after, monthPeriod('2026-10-20')).published, 1, 'the month still counts the archived publication');
}

// The six numbers.
const period = monthPeriod('2026-09-14');
eq(period, { from: '2026-09-01', to: '2026-09-30' });
const done = (id, extra) => task({ id, status: 'Validé', sentAt: '2026-09-02T10:00:00.000Z', deliverable: 'https://x.test', ...extra });
const metricRecords = [client, project,
  done('a', { due: '2026-09-05', signOff: { mode: 'explicit', by: 'A', at: '2026-09-02T20:00:00.000Z', round: 1 }, revisionRound: 1, publishedAt: '2026-09-05T09:00:00.000Z' }),
  done('b', { due: '2026-09-06', signOff: { mode: 'silence', by: 'Validation tacite', at: '2026-09-04T10:00:00.000Z', round: 0 }, revisionRound: 0, publishedAt: '2026-09-07T09:00:00.000Z' }),
  done('c', { due: '2026-09-08', signOff: { mode: 'explicit', by: 'A', at: '2026-09-03T10:00:00.000Z', round: 2 }, revisionRound: 2, publishedAt: '2026-09-08T09:00:00.000Z' }),
  done('e1', { evergreen: true }), done('e2', { evergreen: true }),
  task({ id: 'old', status: 'Validé', signOff: { mode: 'explicit', by: 'A', at: '2026-08-20T10:00:00.000Z', round: 0 }, publishedAt: '2026-08-21T09:00:00.000Z' }),
];
const m = computeMetrics(metricRecords, period);
eq([m.published, m.onTime, Math.round(m.onTimeRate * 100)], [3, 2, 67], 'b went out a day late');
eq(m.medianValidationHours, 17, 'median of 10 h and 24 h explicit decisions');
eq([m.validated, m.silent, Math.round(m.silenceShare * 100)], [3, 1, 33]);
eq(m.roundsPerItem, 1);
eq([m.delivered, m.sold, m.deliveredVsSold], [3, 4, 0.75]);
eq(m.clients[0].evergreen, 2); eq(m.evergreenPerClient, 2);
ok(!m.published || !metricRecords.find((r) => r.id === 'old' && m.onTime === 4), 'August is outside the period');

// The dashboard's client cards: the period's content approved against the quota, without waiting for a
// « publié » click; auto-archived approved work still counts, internal work and paid extras do not.
{
  const work = [
    task({ id: 'w1', status: 'Validé', due: '2026-09-03' }),
    task({ id: 'w2', status: 'Validé', due: '2026-09-04', archived: true, autoArchivedAt: '2026-09-25T02:00:00.000Z' }),
    task({ id: 'w3', status: 'À valider', due: '2026-09-20', scopeUnits: 3 }),
    { id: 'w4', kind: 'plan_item', revision: 1, name: 'Idée', clientId: 'c1', planMonth: '2026-09', createdAt: '2026-08-25T09:00:00.000Z' },
    task({ id: 'x1', status: 'Validé', due: '2026-09-05', publishable: false }),
    task({ id: 'x2', status: 'Validé', due: '2026-09-05', commercialTreatment: 'extra' }),
    task({ id: 'x3', status: 'Validé', due: '2026-09-05', archived: true }),
    task({ id: 'x4', status: 'Validé', due: '2026-08-30' }),
  ];
  eq(clientPeriodWork(work, { ...client, quota: '8' }, period), { planned: 6, approved: 2, quota: 8 }, 'approved in the month, story frames as units');
  eq(clientPeriodWork(work, { ...client, quota: undefined }, period).quota, null, 'no quota sold, no target');
}

// What a client contact may see.
const view = portalView([client, { ...client, id: 'c2', name: 'Other' }, project, { ...project, id: 'p2', clientId: 'c2' },
  task({ id: 'mine', assignee: 'Yasmine', source: 'https://internal', reminders: ['24h'] }), task({ id: 'theirs', clientId: 'c2', projectId: 'p2' }),
  { id: 'cm', kind: 'comment', revision: 1, name: 'hello', taskId: 'mine', createdAt: '2026-09-02T10:00:00.000Z' },
  { id: 'ev1', kind: 'event', revision: 1, name: 'studio only', type: 'lock', audience: 'studio', taskId: 'mine', createdAt: '2026-09-02T10:00:00.000Z' },
  { id: 'ev2', kind: 'event', revision: 1, name: 'both', type: 'reminder', audience: 'both', taskId: 'mine', createdAt: '2026-09-02T10:00:00.000Z' },
], 'c1');
eq(view.map((r) => r.id).sort(), ['c1', 'cm', 'ev2', 'mine', 'p1']);
const mine = view.find((r) => r.id === 'mine');
ok(!('assignee' in mine) && !('source' in mine) && !('reminders' in mine), 'internal fields are stripped for clients');
ok(!('drive' in view[0]) && !('contract' in view[0]), 'studio links are stripped from the client record');

// Internal review: the studio's own check. No client clock, and the client never sees the version under review.
const reviewAt = '2026-09-14T10:00:00.000Z';
const v1 = 'https://x.test/v1.pdf', v2 = 'https://x.test/v2.pdf';
const inReview = submitForReview(task({ status: 'En cours', deliverable: v1, timeEntries: [{ userId: 'u', name: 'U', start: '2026-09-14T09:00:00.000Z' }] }), reviewAt);
eq(inReview.status, 'Validation interne'); eq(inReview.approvalDueAt, undefined); eq(inReview.timeEntries[0].end, reviewAt, 'submitting stops the running clock');
eq(courtOf(inReview), 'studio', 'internal review is the studio’s court');
eq(clientTaskCopy(inReview).status, 'En cours', 'the client reads « En cours »');
ok(!('deliverable' in clientTaskCopy(inReview)), 'a never-sent version stays in the studio');
ok(!clientTaskCopy(inReview).history.some((h) => h.internal), 'internal history lines never reach the client');
const refused = rejectInternally(inReview, 'Logo too small', 'Owner', reviewAt);
eq([refused.status, refused.internalReview.note], ['En cours', 'Logo too small']);
ok(!('internalReview' in clientTaskCopy(refused)) && !('deliverable' in clientTaskCopy(refused)), 'a refused version and its note stay in the studio');
const sentV1 = sendForValidation(submitForReview(refused, reviewAt), reviewAt);
eq([sentV1.status, sentV1.sentDeliverable, sentV1.internalReview], ['À valider', v1, undefined]);
eq(clientTaskCopy(sentV1).deliverable, v1, 'the client sees what was sent');
// After the client's feedback, a new version under review: the client keeps seeing the one they reviewed.
const v2InReview = submitForReview({ ...requestChanges(sentV1, 'Client', reviewAt), deliverable: v2 }, reviewAt, v1);
eq(clientTaskCopy(v2InReview).deliverable, v1);
eq(clientTaskCopy(rejectInternally(v2InReview, 'Not yet', 'Owner', reviewAt)).deliverable, v1);
// Tasks sent before `sentDeliverable` existed: the previous link is kept as the one the client has.
const legacy = { ...task({ status: 'En cours', deliverable: v2, sentAt: '2026-09-01T10:00:00.000Z' }) };
eq(submitForReview(legacy, reviewAt, v1).sentDeliverable, v1);
eq(clientTaskCopy(submitForReview(legacy, reviewAt, v1)).deliverable, v1);
eq(clientTaskCopy(approve(inReview, { mode: 'studio', by: 'Owner', at: reviewAt, round: 0 })).deliverable, v1, 'a validated deliverable is the client’s to see');
const reviewView = portalView([client, project, { ...inReview, id: 'rev' }], 'c1').find((r) => r.id === 'rev');
eq([reviewView.status, 'deliverable' in reviewView], ['En cours', false], 'the portal applies the same copy');
// J−7: a deliverable still in internal review inside the locked week is still not with the client.
const lockEvents = sweep([client, project, task({ id: 'late', status: 'Validation interne', deliverable: v1, due: shiftDay(today, 3) })], at(`${today}T08:00:00.000Z`)).events;
ok(lockEvents.some((e) => e.type === 'lock' && e.taskId === 'late'), 'internal review inside J−7 raises the lock alert');

console.log(`${checks} flow rule checks passed: court, gates, J−${flow.lockDays} lock, ${flow.validationHours} h clock, rounds, sign-off, sweep idempotence, six metrics and the portal view.`);
