# Casablanca time, system theme and task mentions

## Changes

- Timestamp displays, activity charts, recorded-time periods, meeting instants and Instagram timing use Casablanca. Calendar dates remain dates.
- Browser testing found stale WebKit timezone data returning UTC+0 for October 2026. A small bundled Africa/Casablanca transition table from IANA 2026a now protects both server and browser clocks, including Ramadan changes. It covers 2018–2040; other dates use native Intl. Refresh using `node scripts/update-casablanca-time.mjs` with a current Node timezone database when Morocco changes its rules. Source: [IANA Africa rules](https://data.iana.org/time-zones/tzdb/africa).
- New devices default to System; saved explicit Light/Dark choices remain honored. Theme controls appear only in Settings in studio, print and portal.
- Each chat picker contains owners, admins, that task's client contacts and assignee. It supports name search, touch, keyboard selection and highlighted mentions. Names with spaces and UTF-16 selections work.
- The server validates participants and text spans against current task assignment and membership. Mention alerts target unique account IDs, with individual read state. Typed @text creates no broadcast mention alert. Client payloads still omit the workspace roster.
- Client notifications open the task or shared plan discussion. Private or archived items cannot expose a picker. Message removal erases mention metadata.

## Verification

- Full `pnpm test` passed, including new timezone, theme and mention API suites; existing role, file, voice, workflow, publishing and content-plan tests passed.
- Production build and compiled-theme checker passed (121 contrast pairs). Lint passed with existing warnings; changed chat, clock, picker and server files have no lint errors.
- Local browser: Paris device timezone with stale Casablanca data displays `11:35` for `10:35Z`; system color changes apply live and manual Light overrides dark system settings.
- 390×844 mobile light and dark: no horizontal overflow; four permitted roles; keyboard selection and touch sending succeed. An owner mention reaches the client, opens the correct task and clears that contact's unread badge. Client replies preserve selected mentions.
- All browser messages used fictional local users. Temporary preview, sessions, cookies, task fixtures and emulation were removed. Production data was not used for message tests.
