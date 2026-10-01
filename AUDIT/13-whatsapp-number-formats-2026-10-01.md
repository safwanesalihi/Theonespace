# WhatsApp contact formats — 1 October 2026

## Fix

Client profiles, member invitations, member contact editing, and all three outbound WhatsApp templates now use `lib/whatsapp-number.ts`.

| Input | Saved contact |
| --- | --- |
| `0612345678` or `06 12 34 56 78` | `+212612345678` |
| `+212 612345678` or `+212 6 12 34 56 78` | `+212612345678` |
| `00212 (6) 12-34.56 78` or `212612345678` | `+212612345678` |
| `+212 (0)6 12 34 56 78` | `+212612345678` |
| Arabic, Persian or full-width digits | ASCII international digits |
| `+33 6 12 34 56 78` | `+33612345678` |
| Empty field | Contact cleared |

Local numbers are interpreted as Moroccan. International contacts from other countries require a country code. Spaces, ordinary punctuation, typographic dashes and direction markers are handled; letters, extensions, slashes and ambiguous foreign local numbers are rejected.

Morocco uses 10 domestic digits with the trunk `0`, or 9 significant digits after `+212`, as described in [ANRT’s numbering plan](https://www.anrt.ma/en/missions/numerotation). The parser removes the known domestic prefix but never truncates subscriber digits. An overlong Moroccan number gets a translated length error, preserving any previously saved contact.

Forms show local/international examples in French, English and Arabic, allow 60 input characters for formatted entries, expose format hints to screen readers, and keep telephone input direction left-to-right. Member contact visibility and edit permissions retain their existing workspace checks.

## Verification

- `node tests/whatsapp.mjs`: **231 checks passed**, including client create/edit, member invitations/edit, all accepted formats, invalid types/lengths, unchanged contacts after rejection, and canonical recipients for approval/assignment/comment sends from legacy local contacts.
- Full `pnpm test`: passed.
- Production build and TypeScript: passed. Compiled theme check: 121 contrast pairs passed.
- Focused ESLint: no errors; two existing `no-img-element` warnings in unrelated brand brief images.
- Local browser: requested local and spaced international inputs save to the same canonical contact; overlong input remains in the editor with a clear error; corrected spacing saves successfully.
- Mobile browser at 390 × 844: 366 px dialog, 390 px document width, no horizontal page overflow. Screenshot saved outside the repository.
- Temporary fictional member, contact metadata, audit session and cookie removed; local preview stopped; viewport reset.

Provider responses were mocked for tests. No WhatsApp messages were sent to real contacts during this verification.
