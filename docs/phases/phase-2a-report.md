# Phase 2A report (2026-11-20): participants and imports

## Built

| Area | What exists |
|---|---|
| Participants | Per-event list with search and pagination, add, edit, deactivate/reactivate, delete (refused once a participant has a recorded win), photo upload resized to 640 px WebP in the browser. Every change is audited. |
| Custom fields | Per-event definitions: text, number, date (YYYY-MM-DD), yes/no, single choice, multiple choice; required flag; "may appear on public pages" flag. Key and type are fixed after creation; deleting a field clears its values. Database checks enforce key format and reserved names. |
| Import pipeline | Browser parses `.xlsx` (read-excel-file) or `.csv` (papaparse) and the photo `.zip` (fflate). Rows are sent in chunks of at most 500 rows / 600 KB to a staged batch. The server re-validates everything, detects duplicates inside the file and against registered participants, plans each row (new, update, skip, error), and shows a review page. Commit is one transaction. |
| Duplicate modes | Reject (error), skip (leave unchanged), update (keep a before-image for revert). Possible duplicate names are flagged as warnings. |
| Photos | Matched by the photo column or by employee ID. Unsafe ZIP paths (`..`, absolute, drive letters, control characters), system files, unsupported types, oversized entries and suspicious compression ratios are ignored. Images are decoded and re-encoded in the browser, which drops EXIF and GPS. The server re-checks type and dimensions from the bytes. Missing, shared and ambiguous photos are reported; a "photo required" rule turns missing photos into errors. |
| Safety | Invalid rows are never imported unless the administrator ticks "leave out the rows with errors". Commit re-plans inside the transaction and refuses with "check again" if participants changed since the preview. Staged photos live in Postgres, so a failed commit rolls them back too, and cancelling deletes them. Unfinished imports are cancelled after 24 hours. Every stage refuses to run while a raffle is frozen. |
| Revert | A committed import can be reverted before freeze: added participants are removed, updated ones get their before-image back. It refuses if any of them changed after the import or has a win. |
| History and reports | Import history per event, review page with filters and thumbnails, downloadable CSV error report with spreadsheet-formula neutralisation. |
| Template | Downloadable `.xlsx` with every built-in and custom column plus an Instructions sheet listing accepted values. |

## Verified

| Check | Result |
|---|---|
| Automated tests | 136 passing (11 new domain tests, 13 new import integration tests including 5,000 rows) |
| Mutation checks | Removing the roster lock (create, validate, commit), the stale-preview check, the invalid-row consent, in-file duplicate detection, the revert conflict check, staged-photo cleanup, the CSV formula guard or the ZIP traversal check each makes a test fail |
| HTTP smoke | 44/44, including anonymous 401 on admin photos and error reports, and redirects on every new admin page |
| Browser walk-through | Real `.xlsx` with reordered, renamed columns plus a ZIP with valid photos, a corrupt image, a shared photo, a missing photo, `../evil.png`, `__MACOSX` metadata, a text file and a HEIC file. Mapping suggested correctly; unsafe and unsupported entries ignored; corrupt image reported by row; review showed 6 new, 2 errors, 4 warnings; commit without consent refused; commit with consent imported 6 with the right photos. |

## Problems found and fixed during this phase

1. A `<select>` kept showing the old value after a successful save (React 19 form reset), so an administrator could unknowingly save the old value back. Forms now remount from the saved values. The same fix was applied to the event form's accent radios.
2. The photo help text overflowed its card at narrow widths.
3. "1 photos could not be used" wording.
4. The stored photo rule lost its `provided` flag when parsed; fixed before any test relied on it.
5. One mutation (roster lock at import start) was initially not caught; the test now covers every import stage separately, including a freeze that lands between preview and commit.

## Privacy and retention

- Participant records, photos and import rows are visible only to the administrator. Public pages will show only what the event's display settings and each field's "public" flag allow (used from Phase 4).
- Photos are re-encoded in the browser, which removes EXIF metadata including location.
- Logs and audit entries store employee IDs and counts, not names, emails or photo bytes.
- Suggested retention, to confirm with PCAS: delete participant records, photos and import rows for an event 90 days after it closes, keeping winners, snapshots and the audit chain needed to verify the draw. Deletion tooling is planned for Phase 7.

## Carry-overs

| Item | When |
|---|---|
| Prize categories, prizes, prize photos (Part 2B) | Next |
| Event display settings UI for public participant fields (`participant_display` is stored with safe defaults) | Phase 4 |
| Old photos replaced by an "update" import stay stored until the import can no longer be reverted; a cleanup job after freeze | Phase 3 |
