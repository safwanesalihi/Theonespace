# Micro UI/UX — how the small things get caught, and where it still slips

Written after the dock review of 3 Nov 2026. The goal is not a list of fixes but a way of working, so the
same kind of slip stops coming back.

## What slipped, and why

| Slip | Why it got through |
|---|---|
| Names under every dock icon | A general rule (« never make anyone guess an icon ») was applied to a place where it costs more than it gives: a compact rail of six familiar icons, used every day, with a tooltip one hover away. The rule was right in the abstract and wrong for this control. |
| Full menu opened in one click, closed only from the top bar or Ctrl/⌘ B | Each action was checked on its own (« does it open? ») but not as a round trip (« and back? from where the eye now is? »). |
| Two identical toggles side by side once the menu was open | Introduced by the fix itself: the new button was checked, the screen around it was not looked at again. |
| Home figure notes (« novembre ») as white pills on a white card | Colour taken as a fixed value (`rgb(255 255 255 / .8)`) instead of a token relative to the surface it sits on; it read well on the sky, not on the card. |
| Grey system scrollbar with arrows on the dark menu | Scrollbars are rarely on screen in short demos; they show only with a long menu on a laptop height. |

## The checklist that now runs on every UI change

1. **Round trip.** Every open has a close, every expand a collapse, reachable from where the pointer or eye
   ends up — not only from where it started. Escape or a click away where it makes sense.
2. **One control per job on screen.** After a change, look at the whole screen again: no two buttons doing the
   same thing within the same glance.
3. **Density by context.** Labels on touch (no hover) and on rarely used icons; tooltips on a compact desktop
   rail of everyday icons. Every icon still has an `aria-label` and a keyboard-visible tooltip.
4. **Colours relative to their surface.** Chips, pills and borders use `--t-surface-sunken`, `--t-line`… never
   a raw white or black that assumes the background.
5. **Look at the ugly edges.** Long lists (scrollbars), short screens (the dock at < 640 px tall), RTL, night
   theme, empty data, long names.
6. **Check after the animation ends.** Screenshots taken mid-slide hide or invent problems; wait for the
   transition, then judge.
7. **Ask « what would annoy me on the 50th use? »** — not « is it understandable on the 1st? ». The product is
   used every day by the same people.

## Still to improve

- ~~Badge colours differ between the dock and the phone tab bar~~ — aligned: agency gold in the studio, the agency colour in the portal.
- The hover tooltips are CSS only (`::after`): no delay, and they do not avoid the screen edge.
- A walk in Arabic (RTL) of the new collapse button was not done on screen; it uses logical properties only.
