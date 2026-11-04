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