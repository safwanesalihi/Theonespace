# Phase 5 — UI uniformity

## 1. What the stylesheets actually look like

Measured across `app/*.css` (4 113 lines, 8 files before this phase):

| | Count |
|---|---|
| Distinct hex colours | **462** (1 315 occurrences) |
| Distinct `border-radius` values | **30** |
| Distinct `box-shadow` values | **72** |
| Distinct `font-size` values | **33** |
| Distinct breakpoints | **24** — including 760/767/768, 900/980/999/1000, 1100/1200/1250 |
| `!important` declarations | **1 003** |

### The root cause: the same pass, pasted six times

A block headed `/* TRUE GLASSMORPHISM OVERRIDES V2 - HIGH CONTRAST & UNIFIED */` exists in **six of the eight stylesheets** — `globals`, `modern`, `team`, `login`, `flow`, `print` — each ending the file, every declaration `!important`. 26 selector groups are byte-identical across files, including:

```css
.task-table, .task-table tr, .task-table th, .task-table td, .table-area { … }   /* in 6 files */
.tracker-sidebar [data-slot=sidebar-inner], .tracker-sidebar, .sidebar { … }     /* in 6 files */
input, textarea, .pick, .search-input { … }                                      /* in 6 files */
.calendar-grid, .calendar-day, .weekdays > span, .calendar-event { … }           /* in 6 files */
```

They have since **diverged**: of 174 distinct selectors across the six copies, only **22 appear in all six**, and 5 of those carry *different* declarations. So they can no longer be deduplicated by deleting five copies — each has been edited on its own since the paste.

This is why Phase 3's contrast fixes silently failed: with six `!important` copies, whichever file `layout.tsx` imports last wins, and `flow.css` is sixth of eight.

**The measurable consequence** was real, not cosmetic: the sticky actions column rendered transparent (Phase 3, U1) because the shared "make tables see-through" rule beat the cell's own background in five places at once.

### Component variants per concern

Every shared component is declared in **five to eight** different stylesheets:

| Component | Declared in |
|---|---|
| Card surfaces | 7 files (modern 125 rules, globals 90, flow 38, team 27, login 24, print 11) |
| Buttons | 8 files |
| Inputs | 8 files |
| Selects | 7 files |
| Modals | 7 files (print 19, flow 13, globals 13, modern 12) |
| Tables | 7 files |
| Badges / chips | 5 files |
| Empty states | 6 files |

---

## 2. What was done

### `app/tokens.css` — one source of truth, loaded last

New file, imported **after** all seven others in `app/layout.tsx`. Loading order is the point: it is the only way to win a cascade contested by six `!important` copies without escalating further.

The values are **not new** — they are the ones already dominant in the code, given a name:

| Token | Value | Why this one |
|---|---|---|
| `--t-brand` | `#efb849` | the most-used colour after white/black (60 occurrences) |
| `--t-brand-strong` | `#e5a93c` | its hover (39) |
| `--t-brand-ink` | `#251f12` | text on amber — 8:1, where white read 1.9:1 |
| `--t-text` / `--t-text-body` | `#111111` / `#334155` | the two dominant ink tones |
| `--t-text-muted` | `#58637a` | **new value**: the old muted tone failed AA on every surface |
| `--t-page` / `--t-surface` | `#f4f6fa` / `#ffffff` | |
| `--t-line` | `#edecea` | the app's hairline (85 occurrences) |
| `--t-radius-card` | `16px` | 43 occurrences — the card radius |
| `--t-radius-control` | `8px` | 41 — buttons, inputs |
| `--t-size-body` | `12px` | 147 — the workhorse size |
| `--t-shadow-card` / `-raised` / `-modal` | | the three elevations actually in use, out of 72 |
| breakpoints | `767 / 1000 / 1600` | three, replacing 24 near-duplicates (documentation only — CSS cannot use a variable in a media query) |

### The contrast floor

Phase 3 left **45 measured AA failures** it could not reach. The token layer fixes them at the source: one muted tone, applied to every family of secondary text, plus the two cases that needed the *opposite* direction.

Verified by re-measuring every page in the browser:

| Page | Before | After |
|---|---|---|
| Home | 4 | **0** |
| Tasks / Internal tasks | 9 / 3 | **0** |
| Team | 22 | **0** |
| Dashboard (flow) | 32 | **0** |
| Clients / Client (overview, documents, tasks, projects) | 2 | **0** |
| Editorial calendar | 33 | **0** |
| Library | 0 | **0** |

Two of these were fixed the wrong way first and corrected after measuring:
- **The avatar** has two backgrounds — dark grey in the sidebar (white initials are right) and an amber gradient inside tables (white read 1.08:1). Only the table and comment avatars take the dark ink.
- **`.flow-target`** appears on one dark dashboard tile and five light ones, so the class needed both tones.

### Canonical component definitions

One appearance per component, stated in tokens so a future change has a single place to land:

| Component | Canonical |
|---|---|
| **Card** (`.database-card`, `.client-card`, `.board-card`, `.team-card`, `.review-card`, `.detail-split`, `.calendar-wrap`, `.workflow`, `.portal-card`) | `--t-radius-card` (16px), `--t-shadow-card`, white surface |
| **Modal** (`.tracker-modal`) | `--t-radius-card`, `--t-shadow-modal` |
| **Control** (`.btn`, `.pick`, `input`, `textarea`, `.search-input`) | `--t-radius-control` (8px) |
| **Chip** (`.status`, `.file-pill`, `.neutral-badge`, `.counter`) | `--t-radius-chip` (6px) |
| **Primary button** | `--t-brand` on `--t-brand-border`, `--t-brand-ink` text, `--t-brand-strong` on hover |
| **Status chips** | four paired background/ink tokens, each now ≥ 4.5:1 against its own tint |

### Verified after the change

The studio home, the client portal and the print workspace were each re-checked in the browser: branding, layout and spacing unchanged, secondary text visibly more legible. `pnpm test` (11 suites), `tsc --noEmit` (0) and `pnpm build` all pass.

---

## 3. Not done — needs your decision

### C1 — Collapse the six copies of the glassmorphism pass (1–2 days, medium risk)

This is the real fix, and it is **not** a delete-five-copies job: the copies have diverged, so consolidating means diffing 174 selectors, choosing a winner per rule, and re-checking every screen. It touches every page in the app, so it wants its own branch and its own review — not a line item at the end of an audit.

The prize is concrete: **1 003 `!important` declarations** exist almost entirely to fight copies of the same rules. Remove the duplication and most of them become unnecessary, at which point `tokens.css` no longer needs `!important` either.

Suggested order: (1) extract the 22 selectors common to all six into `tokens.css`; (2) delete those from the six copies, re-checking each screen; (3) repeat per file for what remains; (4) drop `!important` where nothing contests it any more.

### C2 — Adopt the tokens in the existing stylesheets (½ day, low risk)
`tokens.css` currently *defines* the vocabulary and applies it to contrast and the canonical components. The 462 hard-coded colours in the other files still say `#efb849` rather than `var(--t-brand)`. A mechanical pass replacing the dominant values with their tokens would make a rebrand a one-line change.

### C3 — Settle the breakpoints (2 hours, low risk)
24 breakpoints, several a pixel apart, produce layout shifts nobody designed. Normalising to the three documented in `tokens.css` is mostly search-and-replace, but it changes layout at the edges, so it needs a visual pass at each width.

### C4 — The print workspace is styled as a separate app
`print.css` is the largest stylesheet (990 lines) with its own focus rings, its own dialog styles and its own table rules. It looks deliberate — the print side is branded "The One Print". Worth confirming: should it converge on the shared components, or stay a distinct surface? Everything above assumes the latter, and left it alone.
