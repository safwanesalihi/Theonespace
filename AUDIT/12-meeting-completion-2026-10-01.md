# Meeting completion — 1 October 2026

## Behaviour

- Hosts (owner, administrator, social media manager) can **End meeting** from an open/in-progress meeting card or the full/minimized integrated call window.
- End asks for confirmation, closes the integrated room for everyone, records `endedAt` and `endedBy`, and moves the meeting into recent history as **Completed** immediately.
- **Leave** closes only the participant's call window. It also works during a connection attempt; it never writes cancellation or completion.
- **Cancel** remains a separate scheduling action. Finished meetings cannot be cancelled, edited back into the schedule, or rejoined.
- The client portal receives the completed record and completion notice; the upcoming meeting counters exclude explicitly finished calls.
- External Google Meet/Zoom links can be recorded as completed in the app. Their call must also be ended in the external tool, as the confirmation explains.

## Server and provider

- `meeting-end` authenticates and enforces the existing meeting-host roles and workspace isolation. Completion still works when a subscription has lapsed, so an active call is not stranded.
- Join and end hold the same Postgres row lock around their provider operations, preventing an in-flight join from reopening a completed room.
- Daily rooms expire immediately with `eject_at_room_exp`; the current presence snapshot is ejected in batches of at most 100 participants. Requests have a shared 12-second timeout.
- A missing room is already closed. Provider failures remain visible, leave the record unfinished, and permit retry. Repeating completion is idempotent and never duplicates notifications.
- Completion and its notifications commit in one transaction. JSON-backed records need no schema migration or new provider credentials.
- Provider reference: [Daily room configuration](https://docs.daily.co/reference/rest-api/rooms/update-room), [presence](https://docs.daily.co/reference/rest-api/rooms/session/get-presence), [ejection](https://docs.daily.co/reference/rest-api/rooms/session/eject), [frame destruction](https://docs.daily.co/reference/daily-js/instance-methods/destroy).

## Verification

- 102 meeting checks: permissions, fields/phases, completion vs cancellation, portal history, provider failure/retry, idempotence, blocked rejoins, external links, missing/empty rooms, and 205-participant batching.
- Full `pnpm test`, TypeScript, focused ESLint, and production build passed. Compiled theme checks cover 121 contrast pairs.
- Local browser: completion from a card, separate cancellation, Leave during connection, completion from a minimized call, mobile 390px layout without overflow and 44px controls, confirmation above the call window, desktop system dark-mode readability.
- Call-control browser verification used a mocked Join response and a local iframe. Provider requests were stubbed in integration tests; no live meeting was ended and no camera/microphone permission was requested.
- Fictional local meeting fixtures and the temporary session were removed after verification.
