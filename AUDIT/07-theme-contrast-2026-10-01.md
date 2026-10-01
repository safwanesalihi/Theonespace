# Theme and contrast audit — 1 October 2026

## Result

**Follow-up correction:** these checks missed populated meeting and print lists, visible decorative dates and single-character counters. They also did not verify the CSS served by the live deployment. Passing the initial checks did not establish that all dark-mode states were readable. See [the populated follow-up](08-populated-theme-2026-10-01.md) for the additional fixes and evidence.

All 30 workspace screens passed the final rendered-text contrast and horizontal-overflow checks in both themes at desktop (1280 × 720) and mobile (390 × 844): **120 checks, zero measured failures**. The checks were repeated against the compiled Next.js app. Results are in [07-contrast-results.json](07-contrast-results.json).

Normal text and placeholders were checked against 4.5:1; large text against 3:1. SVG chart labels use their rendered fill. Translucent backgrounds are composited through their ancestors. Screenshots were inspected for mesh gradients, previews and control layout. This is a focused contrast and workflow audit, not a certification of every accessibility criterion.

## Problems fixed

- Global and duplicated component styles forced dark text onto dark cards. Shared semantic colors now control text, surfaces, borders and status messages.
- Gold accent text needed a separate readable color from gold button backgrounds. Light and dark gold foregrounds are now distinct from button ink.
- Read notifications and outside calendar dates lost contrast through opacity. Their muted text remains readable.
- Sidebar controls and client initials inherited light surfaces despite the sidebar staying dark. Sidebar foregrounds and surfaces now use a consistent local palette.
- Team guidance panels, brand previews, date pickers, task chat, social forms, brief sections and billing fields now use matching foreground/background colors.
- The portal header depended on an unrelated invoice stylesheet for flex layout. Its layout is now explicit, so the theme button stays inside its header and is clickable on desktop and mobile.
- Print chart axes, legends and tooltips now follow the active theme. Gold buttons avoid briefly transitioning through a low-contrast background.
- Sign-in placeholders and public landing gold labels/large metrics now have sufficient contrast.

## Browser coverage

| Area | Screens | Themes and sizes |
| --- | --- | --- |
| Studio | Home, dashboard, tasks, internal tasks, requests, social, Instagram analysis, library, meetings, team, activity, platform, all clients | Light/dark; desktop/mobile |
| Client portal | Home, approvals, tasks, calendar, content plan, deliverables, documents, requests, meetings, statistics, accounts | Light/dark; desktop/mobile |
| Print workspace | Dashboard, income/expenses, orders, invoices, team, activity | Light/dark; desktop/mobile |

Additional states inspected: task table/board/calendar, task preview/detail, client tabs, populated six-section brief and JSON editor, quote editor, date popovers, populated social composer, saved draft list, settings and theme choices, notification popover, meeting form, library entry form, print order form, sign-in and public pages.

Verified actions included switching themes from the header and sidebar, switching workspaces, preserving the client task context on return, saving/reloading a local social draft, saving a brief, opening/closing dialogs and signing out. All browser data was fictional local test data; no social post or invitation was sent.

## Automated checks

- `pnpm test`: all 31 suites passed, covering navigation, briefs, records, roles/permissions, authentication, publishing, finance, meetings, plans, AI and library behavior.
- `node tests/theme.mjs`: 99 contrast pairs passed, including semantic statuses, messages, gold gradients and public-page labels/metrics; the test also guards against broad heading overrides returning.
- `pnpm lint`: zero errors, 22 existing warnings. The added theme test passes lint without warnings.
- `pnpm build`: production build passed.
- `git diff --check`: passed.

## Limits

The compiled app was served locally with the development runtime to permit PGlite fixtures. Production database deployment was not exercised. Live OAuth, social publication, Gemini, WhatsApp, e-mail delivery and video calls require configured credentials and were not exercised against external services. Those handlers were covered by the existing automated suites. Some lists were empty in the browser fixtures (plans, meetings, documents, connected accounts); their populated behavior remains covered by the relevant automated suites rather than a live integration run.
