# Speed: what was measured, what was done, what is next (4 November 2026)

## What makes the app feel slow

Measured against the live sites with plain `curl` (GET only, nothing written):

| | Prod (space.the1core.com) | Demo (theonespace-demo) |
|---|---|---|
| Where the server function runs | **iad1, Washington (USA)** (`x-vercel-id: cdg1::iad1::…`: the page is served from the Paris edge, the function runs in the USA) | **iad1, Washington** |
| Same request, no database call | 350–380 ms | 350–430 ms |
| Same request with one database query | **+80 to +130 ms** | +0 ms |
| So the database is | far from the function (Europe, from the figure) | next to it (Neon, US East) |

Every database query of the production app crosses the Atlantic: about 100 ms each. The server was never asked to
run in the database's region (`vercel.json` had no `regions`, so Vercel used its default, Washington).

Round trips per request, counted on a studio of 5 clients and 120 tasks (`node scripts/perf-count.mjs 100`):

| Request | Queries | Same machine | Database 100 ms away, before | After (round trips cut) |
|---|---|---|---|---|
| Page open (GET /api/records) | 19 | 24 ms | **~0.7 s** | **~0.36 s** |
| Poll, nothing changed (every 5 s per open tab) | 3 | 7 ms | **~0.35 s** | **~0.23 s** |
| Create or update a task | 26 | ~35 ms | **~0.9 to 1.1 s** | **~0.59 s** |

The code was already tuned to read in parallel; the rest is distance. The same code, with the function next to the
database, answers a click in tens of milliseconds.

## Done

- `vercel.json`: `"regions": ["cdg1"]` (Paris). **It must be the region of the Supabase project**: Supabase Paris
  (`eu-west-3`) for the new SaaS. If a project's database is elsewhere, set its function region to the closest one
  (Vercel → Settings → Functions → Function Region) rather than keeping this file's value.
- Polls slow down for a tab nobody is using (`lib/poll-delay.ts`): 5 s while someone works, 15 s after 30 s without
  activity, 45 s after 5 minutes. A tab catches up at once when its owner comes back. This divides the idle load by 3 to 9.
- Fewer sequential round trips, same queries and same answers (`scripts/perf-count.mjs 100 trace` prints each query
  with the wave it waited in): the poll's version stamp is read while the membership is (a poll: 3 waves → 2); the plan
  check runs while the rows are read (every change: −1 wave); a plan's state and its usage are read together (−1 wave on
  every page open and every change); the people, plan, brand and settings of the page are read while the rows are
  (page open: 6 waves → 3). Changes: 8 waves → 5.
- `scripts/perf-count.mjs`: the measurement above, to re-run after any change to the records pipeline.

## For the existing production (the owner's own project: not changed from here)

1. Read the database's region: the host of `DATABASE_URL` reads `aws-0-<region>.pooler.supabase.com`.
2. Vercel → the project → Settings → Functions → **Function Region** → the Vercel region next to it
   (Paris `cdg1`, Frankfurt `fra1`, London `lhr1`), then redeploy.
3. Measure again with the `curl` check above: the `x-vercel-id` must no longer say `iad1`, and a request with one
   database query must cost about the same as one without.

## Next (round trips, worth doing even with the right region)

- A write answers with the whole workspace again (16 more queries, one more wave): answer with the changed rows and the
  new stamp, or reuse what was read before the write for the actions that only touch tasks.
- Session and membership are two sequential queries on every request: one joined query makes a poll one round trip.
- Tables created on first use (`CREATE TABLE IF NOT EXISTS` in subscriptions, signup, access requests, site content,
  login throttle, platform log…) cost several round trips on every cold server instance: move them to a migration.
- The same `meta` rows (process, settings, brand) are read three or four times per request.
- Plan usage counters are five separate queries: one query with sub-selects.
