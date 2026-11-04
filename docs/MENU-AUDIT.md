# Menu audit (feature/ui-final, 3 November 2026)

Every way into a page, for each role, and what to merge, move or hide so no screen is useless.
Sources: `features/workspace/dock.tsx` (dock on a computer, bottom bar on a phone), `features/studio/studio-app.tsx`
(which tabs the dock gets), `features/studio/studio-navigation.tsx` (« Tout le menu », the full sidebar),
`features/workspace/sidebar-nav.tsx` (default groups), `features/studio/use-route-guard.ts` (who may open what).

## 1. What each role sees today

### Dock (computer) and bottom bar (phone)

| Role | Daily tabs | Then |
|---|---|---|
| Owner, Admin | Accueil · Tâches · Demandes · Social · Clients | Rechercher · Tout le menu · Paramètres (avatar) |
| Social media manager | Accueil · Tâches · Social · Clients | same |
| Member (creative), Observer | Accueil · Tâches · Clients · Équipe | same |
| Client (portal) | Accueil · À valider · Tâches · Calendrier · Livrables · Demander un contenu | Tout le menu · Paramètres |

On a phone the same tabs sit in the bottom bar, with « Plus » opening the full menu.

### « Tout le menu » (full sidebar)

| Entry | Owner | Admin | Social | Member | Observer | Used for |
|---|:-:|:-:|:-:|:-:|:-:|---|
| Rechercher (⌘K) | ✓ | ✓ | ✓ | ✓ | ✓ | find a task or client |
| Nouveau | ✓ | ✓ | | | | new task |
| Accueil | ✓ | ✓ | ✓ | ✓ | ✓ | today's decisions |
| Personnaliser | ✓ | | | | | the studio's process, pages, roles, fields (set-up, rarely) |
| Tableau de bord | ✓ | ✓ | | | | the validation pipeline and its analysis |
| **Production** · Tâches | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Tâches internes | ✓ | ✓ | ✓ | ✓ | ✓ | the agency's own tasks |
| Shootings | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Demandes | ✓ | ✓ | | | | client requests inbox |
| **Contenu** · Social | ✓ | ✓ | ✓ | | | publishing |
| Analyse Instagram | ✓ | ✓ | | | | one account's report |
| Recherche Instagram | ✓ | ✓ | | | | find creators by city and theme, then analyse them |
| Bibliothèque | ✓ | ✓ | ✓ | ✓ | ✓ | prompts, assets, presets, sites |
| **Studio** · CRM | ✓ | ✓ | | | | prospects |
| Réunions | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Équipe | ✓ | ✓ | ✓ | ✓ | ✓ | members (read-only below Admin) |
| Paramètres de l'agence | ✓ | ✓ | | | | plan, logo and colour, validation rules |
| Activité | ✓ | | | | | who worked when |
| Plateforme | platform account only | | | | | The One Core's console |
| **Clients · n** · Tous les clients + one line per client | ✓ | ✓ | ✓ | ✓ | ✓ | |

### Settings

| Where | What it holds |
|---|---|
| Avatar « Paramètres » (dock, sidebar footer) | the person's photo, name, language, theme |
| Paramètres de l'agence | plan, logo and colour, validation rules |
| Personnaliser | process (statuses, work types), pages on/off and names, roles, fields, client portal |

Any page a role may not open sends them home (the client to their portal), the same way everywhere.

## 2. Findings

1. **Two « Paramètres ».** The avatar says « Paramètres » and opens the person's own account; « Paramètres de
   l'agence » is something else. People open the wrong one.
2. **Personnaliser sits with the daily pages.** It is first-week set-up, yet it sits at the top of the menu,
   between Accueil and Tableau de bord, above everything used every day.
3. **Instagram is two pages for one job.** Recherche finds creators, then sends each to Analyse. Two menu
   lines, two page titles, one tool.
4. **An unconfigured Instagram still shows a working form.** Without the data provider the page says it is not
   available yet, but the field and the « Analyser » button stay active and fail when used.
5. **Tâches internes is a second task list.** The dock's « Tâches » already lights up on it: people treat it
   as one place with a filter.
6. **Personnaliser and Paramètres de l'agence are both agency set-up**, in two places.
7. **Member and Observer have Équipe in their dock**, a page they can only read and rarely open, while
   Réunions and Shootings (which they do attend) are one level down.
8. **Accueil and Tableau de bord** overlap for managers: both open on « what waits ». They differ (today's
   decisions vs the whole pipeline), but the name « Tableau de bord » does not say so.

## 3. Changes made in this branch (safe: nothing removed)

- **Avatar renamed « Mon compte »** (dock, sidebar footer, its dialog title), so it can't be mistaken for the
  agency's settings. (finding 1)
- **Personnaliser moved into the « Studio » group, next to Paramètres de l'agence.** The top of the menu keeps
  Accueil and Tableau de bord. The owner can still drag it elsewhere like any page. (finding 2)
- **Instagram pages without their provider**: the form is disabled under the notice, so nobody types into a
  tool that cannot answer. (finding 4)

## 4. For the owner to decide (each removes or merges a screen)

| # | Proposal | Effect | Recommendation |
|---|---|---|---|
| A | Merge **Analyse Instagram** and **Recherche Instagram** into one page « Instagram » with two tabs (Rechercher · Analyser) | one menu line instead of two; old links keep working by tab | yes |
| B | Fold **Tâches internes** into **Tâches** as a client filter « Interne » | one task list; the page « Tâches internes » goes away | yes |
| C | Make **Personnaliser** a tab of **Paramètres de l'agence** (Abonnement · Logo et couleur · Règles · Processus) | one place for agency set-up | yes, after A and B |
| D | Hide **Instagram** from the menu when the space has no data provider, instead of showing a page that says « not available » | fewer dead ends; the feature reappears once enabled | yes |
| E | Dock for **Member** and **Observer**: Réunions instead of Équipe | daily tab for what they attend | to try with an agency |
| F | Rename **Tableau de bord** to « Pilotage » (the name the landing uses) | says what it is: the pipeline, not today | optional |

## 5. Done after the owner's decision (A, B, D, then C)

The owner approved A, B, C and D. E waits for a test with a real agency; F was not picked.

| # | What changed | Old link | Where it lands |
|---|---|---|---|
| A | One menu line « Instagram », tabs Rechercher · Analyser (`features/ig-analyzer/instagram-page.tsx`) | `#ig-search` | `#ig//search` (Rechercher) |
| | | `#ig`, `#ig/<account>` | Analyser, that account open |
| B | « Tâches internes » removed; Tâches has a client filter: Clients · Interne · Clients et interne | `#internal` | `#tasks//internal` (Interne) |
| D | Instagram left out of the menu while the space has no data provider (payload `instagram`) | — | the page still opens by its link, with its notice |
| C | « Personnaliser » removed from the menu; « Paramètres de l'agence » in tabs: Abonnement · Logo et couleur · Règles · Processus (owner only, `features/studio/agency-settings.tsx`) | `#customize` | `#settings//process`; an administrator gets `#settings` |

Old links are rewritten in one place, `lib/navigation.ts` `currentRoute`, and the address bar follows.
Saved processes keep their « internal » and « ig-search » page settings so they still load
(`lib/process.ts` `mergedPages`); neither shows in the menu or the Pages card. « Vos liens » stays a card
of the Processus tab. The Tâches counters (dock, sidebar, phone bar) are unchanged.

## 6. Team and clients in « Paramètres de l'agence » (owner's request, 4 November 2026)

| Role | Old link | Where it lands |
|---|---|---|
| Owner, Administrator | `#team`, `#team//invite` | `#settings//team` (Équipe tab; `/invite` scrolls to the form) |
| | `#clients` | `#settings//clients` (Clients tab: list, search, « Nouveau client », the archive) |
| Social, Member, Observer | `#team`, `#clients` | unchanged: the team read-only, the clients list |

Tabs for the owner: Abonnement · Équipe · Clients · Logo et couleur · Règles · Processus (an administrator
has all but Processus). The redirect replaces the address (`navigate(…, { replace: true })` in
`features/workspace/use-workspace-navigation.ts`), so Back does not bounce on the old link. The sidebar keeps
« Tous les clients » and one line per client; for the owner and administrators « Tous les clients », « Équipe »
and the dock's « Clients » open those tabs. A client's portal access stays on that client's page.
## 7. One personal panel, one agency place (4 November 2026)

| Where | What it holds |
|---|---|
| « Mon compte » (avatar in the dock and the sidebar footer) | by category: **Profil** (photo, name, e-mail, WhatsApp) · **Apparence** (light or dark) · **Langue** · **Sécurité** (password, sign-out) |
| « Paramètres de l'agence » | Abonnement · Équipe · Clients · Logo et couleur · Règles · **Google Drive** · Processus (owner) |

Google Drive was the one agency setting inside the personal dialog: it is now its own tab, and a Google
sign-in returns there (`lib/drive-oauth.ts`; an older link back to `#home` is forwarded). A person's own WhatsApp
number, once only editable on the team list, is in Profil too. There are no notification preferences in the
app today (the bell only lists and marks read), so « Mon compte » has no Notifications category yet: adding
one needs stored preferences and a sender that reads them.
## 8. Phone bottom bar per role (4 November 2026)

| Role | Bottom bar (phone) | Under « Plus » too |
|---|---|---|
| Owner | Accueil · Tâches · Tableau de bord · Activité | Demandes, Social |
| Administrator | Accueil · Tâches · Tableau de bord · Social (Activité is the owner's) | Demandes |
| Social media manager | Accueil · Tâches · Social · Clients (unchanged) | |
| Member, Observer | Accueil · Tâches · Clients · Équipe (unchanged) | |

Each counter belongs to its page: Tâches counts what waits for an answer, Tableau de bord its unread events (the
sidebar's number). The computer's dock is unchanged. A page the studio turned off is skipped and the next
daily page takes its place.
## 9. Loader without the wrong brand (4 November 2026)

- The last workspace this browser opened is kept in a small cookie `the-one.brand` (name, logo id, colour, white-on-dark, One Core studio flag; `lib/boot-brand.ts`), written with the brand itself (`brand-store.ts`) and cleared at sign-out. The server validates it (logo id pattern, hex colour) before drawing anything.
- `/` (app/page.tsx) reads it and draws the loading screen with that brand in the HTML itself: the logo as a still `<img>`, else the name as text, visible with no script; the grains then gather over it while the still fades (`components/particle-mark.tsx`). The studio's own boot screen starts from the same brand, so there is no empty slot and no switch of marks.
- Nothing remembered (first visit, after sign-out, `/login`, the root `app/loading.tsx` that wraps every page): three neutral dots in CSS, no mark and no « The One Space » wordmark.
- Switching workspace shows the target's remembered logo (theme-aware class), else its name; never another workspace's mark.
- Reduced motion: the dots stand still; the grains are drawn in place once, as before.
- Known limit: the root `loading.tsx` boundary still streams its neutral screen ahead of the page's branded one; both arrive in the first response chunk, so at worst one neutral frame, never another brand.

## 10. Perceived speed (4 November 2026)

Measured on the production build's chunk graph (the local production server refuses the embedded database, so
no signed-in page loads there; a script walks what `/` loads for a signed-in user and what each lazy screen adds).

- Before: the studio's up-front JS, paid on every signed-in screen, was 576 KB gzipped (1.9 MB raw). The Instagram
  analyzer was imported directly by `studio-pages.tsx` and brought the whole charts library (recharts) with it.
- Now on demand, each with its page outline in skeletons while it arrives: Instagram analyzer, platform console,
  requests inbox, team page; the sign-in form (only for an ended session or a password to choose).
- The content plan (studio and portal) shows skeletons instead of a panel-wide spinner when a plan opens.
- Kept as is: motion (dock and tasks use it on every screen), the meetings page (the call bar imports the same
  module). Already on demand before: PDF engine, video calls, text encodings, dashboard charts.
- No poll and no chained request added.
