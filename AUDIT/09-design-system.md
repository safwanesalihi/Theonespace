# Shared design system — 1 October 2026

## Ownership

`app/styles.css` is the only global stylesheet entry. It loads the palette before module layouts and shared appearance last. `app/design-tokens.css` owns both theme palettes. `app/design-system.css` owns the shared templates. Module styles retain layout, content sizing and responsive arrangement.

## Templates

| Template | Contract |
| --- | --- |
| Card / panel | `Surface`, default tone: semantic surface, text, line, radius and shadow |
| Supporting card | `tone="subtle"`: sunken surface, no elevation |
| Highlight / metric | `tone="gold"`: gold mesh, semantic foreground |
| Inverse surface | `tone="inverse"`: dark surface and readable local text roles |
| Interactive card | Native button/link via `asChild`; shared hover, press and focus; selection uses gold mesh |
| Primary action | Gold gradient and contrasting ink; one control radius |
| Secondary / ghost / destructive | Semantic surface, transparent or solid danger treatment |
| Field | Theme surface, body text, readable placeholder, visible focus |
| Tab / switch | Sunken track, muted idle label, gold selection with contrasting ink |
| Dialog / sheet / menu | Shared surface and text roles; bounded dialog height and internal scroll |
| Table | Semantic headers, rows, names and separators |
| Status / priority | Separate semantic color pairs; low blue, medium yellow, high orange, urgent red |
| Chart | Shared status/series colors; readable text and tooltip roles independent of series fill |
| Empty state | Muted semantic text, without fading the entire container |

Use the native element to keep its behavior and semantics:

```tsx
<Surface asChild tone="gold" key={item.id}>
  <button onClick={openItem} aria-pressed={selected}>
    <span>{item.label}</span>
    <strong>{item.value}</strong>
  </button>
</Surface>
```

List keys belong to `Surface`. Avoid local background, text, radius, border and shadow declarations on migrated card containers. Use role tokens rather than theme-specific hex colors. Brand fills and brand text use separate tokens; custom colors are adjusted for text contrast against both themes and brand tints.

## Adoption

105 Surface locations across 23 modules: studio and client dashboards, brand brief, board/calendar, client documents, editorial maps, portal, print workspace, meetings, requests, team, activity, library, analytics, social accounts/reports, assistant, branding, billing and platform administration. Repeated mapped cards share the same contract. The detailed inventory is `09-surface-adoption.json`.

Shared controls also apply to existing Radix components and legacy `.btn` / `.icon-button` consumers. This removes the need for a separate appearance patch on each route.

## Responsive and accessibility rules

- Phone controls have a minimum 44 px height; close and icon buttons have a 44 px minimum width.
- Phone text fields use 16 px type to prevent iOS focus zoom.
- Cards have a 16 px phone radius and suppress hover translation on small screens.
- Keyboard focus is visible, and reduced-motion preferences suppress card animations.
- Active gold navigation changes its foreground immediately, preventing a low-contrast intermediate color.
- Informational completed/cancelled states remain readable.

## Verification

The source and compiled CSS checks cover 121 contrast pairs, including text roles, statuses, priorities, heatmap levels and gradient stops. Structural checks enforce Surface adoption, list-key placement, palette ownership and stylesheet order. Custom-brand tests cover both themes and tinted backgrounds.

162 browser states passed with no detected text-contrast failures or page overflow. Checks use fictional local data and the compiled application. They cover light/dark desktop and phone layouts, populated studio/client/portal/print screens, editorial maps, analytics tabs, brief and invoice editors, notification controls and the client-task return context. The machine-readable browser results record the actual routes, theme, viewport, text counts and findings. Screenshot evidence is in `design-system/`.

All 32 test suites, TypeScript and the production build passed. Lint reported zero errors and 22 existing warnings.

The browser contrast scan complements manual visual inspection; it is not a complete WCAG certification. External OAuth, actual social publishing, email delivery and provider billing are covered by existing mocked behavior suites, not live service transactions.
