# Phase 4 report (2026-11-21): public pages and presentation

## Built

| Area | What exists |
|---|---|
| Presentation cursor | One row per event saying which screen is showing (lobby, prize line-up, prize draw, winner wall, recap), which prize and draw, and the reveal phase (showing the prize, drawing, winner locked in, revealing) with its start time, countdown and scene length. Check constraints keep the combinations legal. |
| Reveal log | `draw_reveal`, one append-only row per revealed draw with the time it was revealed and the time the scene ends (`visible_at`). A trigger accepts only committed draws of the same raffle. Every first reveal writes a `draw.revealed` audit entry. |
| Reveal gating | The public state carries the winner only while the cursor is revealing that draw. The winner wall, the public winners page and the event page list a winner only after `visible_at`, so nobody sees the name before the scene ends. A reset winner disappears everywhere, even if the screen still pointed at them. |
| State API | `GET /api/presentation/[event]/state`: published or live events only, `private, no-cache`, ETag over the body (304 when unchanged), server time in `X-Server-Now`. Polled once a second. |
| Presentation display | `/presentation/[event]` plus `/prizes`, `/draw/[prizeId]`, `/winner-wall` and `/recap`. One client provider polls the state, corrects for clock skew, and follows the director to the right route (add `?follow=0` to pin a page). The reveal is driven by the server's start time, so a refresh resumes at the same point instead of replaying. "Reconnecting…" shows when the server cannot be reached; the last state stays on screen. |
| Placeholder reveal | Countdown, then a brick wall that builds up and opens on the winner card. Every scene key maps to it through `RevealScene`, which Phase 5 replaces scene by scene. Scene contract: winner, prize, accent, quality, elapsed time and duration. |
| Director console | Presentation panel on the draw console: current screen, buttons for lobby, prize line-up, winner wall and recap, "Show on screen" per prize, and a link to open the display. Drawing a prize puts it on screen as "drawing", then "locked in". "Reveal on screen" starts the reveal; pressing it again during the reveal does nothing, and later it replays the scene. A reset takes the draw off the screen. |
| Winner display settings | On the event page: whether department, job title, photo and short description may be shown (name always), and the countdown length (0–30 s). Employee numbers and email addresses are never sent. Participant photos are served publicly only while photos are switched on; switching them off purges the event's cached images. |
| Public pages | `/prizes` (catalogue of published events), `/winners` (revealed winners of each event's active raffle only, with a link to verify), and the event page now lists prizes, winners and a verify link. Navigation gained Prizes and Winners. |
| Printable manifest | `/admin/.../raffle/[id]/manifest`: fingerprints, what was frozen, prizes in draw order with who can win, how to check later, and two witness signature lines. Downloads for the exact participant and prize snapshot files. Admin chrome is hidden when printing. |
| Post-draw report | `/admin/.../raffle/[id]/report`: summary, the verifier run on the server (snapshots, manifest, seed, drand signatures, recomputed draws) plus the audit chain, every draw including resets with names, pool size and reveal time, and what the report does not prove. |

## Verified

| Check | Result |
|---|---|
| Automated tests | 196 passing (13 new): 8 presentation integration tests (winner absent from every payload until the reveal, public lists held until the scene ends, double-click and replay, reset withdraws the winner, cross-event refusals, draft events hidden, reveal-log and cursor backstops, display settings and photo privacy, countdown setting, only the active raffle after a Fresh Start) and 5 unit tests (reveal clock boundaries, scene durations, display defaults, countdown clamping). |
| Browser tests (exit criterion) | `npm run test:e2e`, 2 of 2. A refresh while the winner is locked in shows no name in the page or in any state response; a refresh during the countdown and again mid-scene resumes at the same point (progress never goes backwards) and the final card appears on time; a refresh after the reveal shows the final card without replaying. The winner wall drops a reset winner, "Reconnecting…" appears when the API is blocked and clears when it returns, and `?follow=0` pins a page. |
| Mutation checks | 15 of 15 caught: winner sent before the reveal, public lists ignoring `visible_at`, voided winners kept, screen trusting a voided draw, superseded raffle treated as active, reveal restarting on a double click, reveal of a voided draw, reveal across events, `visible_at` ignoring the scene, reset leaving the draw on screen, department switch ignored, hidden participant photo still served, reveal clock boundary, and both reveal-log triggers. |
| HTTP smoke | 86/86, including all presentation routes, the state API with ETag and 304, 404s for draft events and bad slugs, the prize catalogue, the new admin pages for anonymous and signed-in users, the snapshot download (no names inside) and the report running the verifier. |
| Browser walk-through | On a production build against the local test database, with live drand quicknet rounds: display settings saved (job title off, 3 s countdown), raffle prepared and frozen in the UI, printable manifest checked, display followed the director to the prize line-up and the draw, "locked in" showed no name, the reveal counted down from 3 and showed Walker D without a job title; reset as winner absent took them off the screen; the redraw drew from 11 candidates; the TV was drawn and revealed; the winner wall and `/winners` showed only the two standing winners; after Complete the report passed every check, 3 of 3 draws reproduced. |

## Problems found and fixed during this phase

1. **Database guard tests could pass for the wrong reason.** Prisma's error message includes a code excerpt of the calling line, and that line contained the expected text, so `toThrow(/append-only/)` matched whatever the error was. A reveal-log test was passing because a different check failed. A new `databaseRefusal` helper reads only the database's own message; all 12 such assertions from Phases 1–3 and the new ones use it, and all still pass with the exact trigger messages.
2. A reveal ran its nested lookups in parallel on one transaction connection (pg deprecation warning). Split into sequential queries.
3. Client components imported types from a server module, which the existing guard test forbids. The types moved to `modules/presentation/domain/state-types.ts`.
4. Editing files from Python on Windows wrote CRLF line endings, which broke the server-action guard test. Converted back to LF; nothing CRLF was ever committed.
5. With only two prizes, the line-up tiles stretched across the screen and the page scrolled. Tiles now keep a fixed width.
6. After a reset, the old "Slot 1 drawn…" message stayed next to the "Redraw" button. The draw form now remounts for each new slot attempt.
7. While drawing was open, the report said "0 of 3 draws reproduced". It now says the draws are checked once the seed is revealed.

## Decisions taken

- The cursor is per event, not per raffle, so the lobby and prize line-up work before any raffle exists.
- The presentation stays public for published and live events (no unlisted token).
- The reveal time is stored when the reveal starts, so changing the countdown setting mid-event cannot shift a reveal already on screen.
- Starting a draw moves the screen to that prize immediately, even if another reveal is still playing. The interrupted winner still appears on the wall once their scene time has passed.
- `/winners` shows only the active raffle of each event (frozen, drawing or completed). Winners of a superseded raffle stay on its verify page only (D12 default).
- Playwright 1.64.1 was added as a dev dependency (newest release older than two weeks). Its database steps run through `tests/e2e/director.mts` with `tsx`, because Playwright's loader cannot import the ESM Prisma client.

## Still open

- Should "winner absent" exclude that person from every remaining prize? (Carried from Phase 3. Current behaviour: same prize only.)
- `npm audit` now reports 4 moderate findings from a new `minimatch` advisory. They come only through the shadcn CLI (a dev tool); the production audit is 0. Waiting for an upstream release.

## Deploy note

Migration `20261122090000_presentation` must be applied to Neon (`npm run db:migrate`) before this phase is pushed.

## Carry-overs

| Item | When |
|---|---|
| The four real reveal scenes, audio, GPU quality tiers | Phase 5 |
| Line-up and winner wall layouts for many prizes (paging or auto-scroll on a TV) | Phase 5 |
| Photos orphaned by update imports | Phase 7 |
