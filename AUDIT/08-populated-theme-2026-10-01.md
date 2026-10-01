# Populated dark-mode follow-up — 1 October 2026

## What the screenshots exposed

The initial audit used empty meeting and print lists. Its text scanner also excluded visible `aria-hidden` dates and one-character counters. These were coverage gaps.

A fresh request to the public production page loaded `/_next/static/immutable/chunks/33ptgd013y-jy.css`, which still contained a global `color:#0f172a!important` rule for headings and bold text. That rule explains the unreadable meeting titles, date numbers, print headings and invoice numbers in the screenshots. The local source and compiled build already lacked it; the live assets had not been verified. This observation does not establish why the deployed stylesheet was older.

Populating the local database revealed five additional contrast failures in cancelled/completed meeting cards because the entire card had `opacity:.65`.

## Fixes

- Completed and cancelled meetings keep fully readable text. Cancellation is identified by its badge and crossed-out title.
- Past portal agenda entries and recurring/skipped social posts retain readable text without fading the entire item.
- Voided print movements use a crossed-out label rather than reduced opacity.
- Print panels, tables, input borders, hover outlines and modal borders use the shared theme palette. The bright white panel borders are removed.
- Primary button icons inherit the button's foreground, keeping dark ink on gold.
- Global chart color defaults use theme variables.
- Every build now checks **compiled CSS assets**, as well as all app/vendor source styles, for broad heading overrides and faded informational content. The previous navy override and faded meeting rule are regression cases in the check.

## Browser verification

**28 populated checks passed with zero measured text-contrast or page-overflow failures.** Results: [08-populated-contrast-results.json](08-populated-contrast-results.json).

| Screen | Fixture coverage | Theme/viewport coverage |
| --- | --- | --- |
| Studio meetings | Two upcoming meetings, one completed, one cancelled; dates, names, agenda, attendees, badges and actions | Light/dark; 1280×720 and 390×844 |
| Portal meetings | The same four client-visible meetings | Light/dark; 1280×720 and 390×844 |
| Print dashboard | Six months of income/expenses, balances, outstanding payments, production counts and chart labels | Light/dark; 1280×720 and 390×844 |
| Print orders | New, in production, ready, delivered and cancelled; amounts and payment progress | Light/dark; 1280×720 and 390×844 |
| Print invoices | Draft, sent, accepted, refused and paid; document numbers, dates and totals | Light/dark; 1280×720 and 390×844 |
| Print movements | Populated income and expense rows with linked order, amounts and actions | Light/dark; 1280×720 and 390×844 |
| Invoice editor | Existing client, line item, quantity, unit price, totals, VAT, notes and dates | Light/dark; desktop and mobile |

Before measuring, each screen had to contain its expected record count. Loading/empty states were rejected. Visible decorative dates and single-character numbers were included. Thresholds: 4.5:1 for normal text, 3:1 for large text. SVG labels were measured using their fill. Screenshots were inspected, and the populated chart contained 12 bars with positive rendered dimensions.

Verified interactions include switching themes/workspaces, mobile print navigation, opening/cancelling the populated invoice editor and viewing the client portal. No invitation, social post, video call or real invoice was sent.

## Build and regression checks

- `pnpm test`: all 31 suites passed.
- `pnpm lint`: zero errors, 22 existing warnings.
- `pnpm build`: passed, including the new automatic postbuild CSS check.
- `node tests/theme.mjs --compiled`: 99 color pairs and 25 source/compiled CSS files passed.
- `git diff --check`: passed.

## Limits

The compiled Next.js app was served locally using the development runtime so it could read fictional PGlite fixtures. The production database and external OAuth, publishing, e-mail, AI and video services were not exercised. This follow-up closes the screenshot-specific populated-state gaps; it is not a claim that every external integration or accessibility criterion is verified.
