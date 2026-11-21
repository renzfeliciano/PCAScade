# Phase 2B report (2026-11-21): prizes, categories and prize import

## Built

| Area | What exists |
|---|---|
| Prize categories | Per event: name, description, display order and one of the four reveal scenes (Brick by Brick, Build It Up, The Big Lift, The Grand Finale). Names are unique per event regardless of case. A category with prizes cannot be deleted. Up to 50 per event. |
| Prizes | Code, name, description, number of winners (1 to 1,000), optional category, draw order, available or withdrawn, and a photo. Codes are unique per event regardless of case. New prizes are drawn last; the order is changed with up and down buttons and is always kept as 1, 2, 3 and so on. A prize with draws on record cannot be deleted, only withdrawn. Up to 500 per event. |
| Prize photos | Resized in the browser to at most 1,280 pixels (participants stay at 640) and re-encoded as WebP, which drops location data. Replacing or deleting a photo removes the old file and purges its CDN cache tag. |
| Prize import | Uses the same import engine as participants: Excel or CSV plus an optional photo ZIP, column matching, server re-validation, review page, consent for rows with errors, one-transaction commit, revert, history and CSV error report. Categories are matched by name or slug and must already exist. Imported prizes are added after the existing ones. In update mode only the mapped columns change. |
| Freeze lock | Every prize, category and prize-import change is refused while a raffle preparation is frozen or drawing, using the same per-event lock as participants. |
| Database checks | Prize code format, name length, quantity at most 1,000, draw order positive, case-insensitive unique code and category name, and an import row can point at a participant or a prize but not both. |
| Audit | Category and prize creation, edits (with what changed), reordering, status changes, photo changes and deletion. |

## Verified

| Check | Result |
|---|---|
| Automated tests | 155 passing: 15 new prize and prize-import integration tests and 5 new prize domain unit tests |
| Mutation checks | 12 of 12 caught: the freeze lock on prizes and on categories, the same-event category check, gap closing after delete, refusing to delete a drawn prize, old photo removal, update-only-mapped-columns, the prize revert conflict check, linking import rows to prizes, unknown-category errors, repeated codes in a file, and a single audit entry per status change |
| HTTP smoke | 53/53, including anonymous redirects and signed-in access for every new page |
| Browser walk-through | Categories created, including a case-variant duplicate that was refused with the typed values kept. Messy prize sheet plus ZIP: columns matched from different headers, an unsafe ZIP path ignored, two rows sharing a code, an unknown category and a zero quantity reported, commit refused without consent and done with it. 3 prizes created in file order with categories, scenes and photos (2000 px source stored at 1280). Reordering, validation errors keeping all values, saved dropdown showing the saved category, and revert refused after a hand edit naming the row. |

## Problems found and fixed during this phase

1. `--password-stdin` stored a byte-order mark when the password was piped from Windows PowerShell, which made the password unusable. The bootstrap script now strips it.
2. A stray vertical scrollbar appeared beside the event section tabs. The underline no longer overflows.
3. "1 files ignored" and "1 photos" wording in the import wizard.
4. The new-category form would have lost typed values after an error (the React 19 reset seen in 2A). It returns the submitted values like the other forms.

## Decisions taken

- Prizes without a category will use the Brick by Brick scene in the presentation (Phase 5).
- Prize import requires categories to exist first rather than creating them, because each category needs a deliberate scene choice.
- Participant photos keep their 640 px limit; prize photos use 1,280 px for the big screen.

## Deploy note

Migration `20261121090000_prizes_admin` must be applied to Neon (`npm run db:migrate`) before this phase is pushed.

## Carry-overs

| Item | When |
|---|---|
| Eligibility rules per prize (`eligibility_rule` is stored, empty) | Phase 3 |
| Public prize catalogue | Phase 4 |
| Old photos replaced by an "update" import stay stored until the import can no longer be reverted | Phase 3 |
