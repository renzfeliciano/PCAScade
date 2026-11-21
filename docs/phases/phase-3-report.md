# Phase 3 report (2026-11-21): raffle engine

## Built

| Area | What exists |
|---|---|
| Prepare | A raffle preparation per event takes canonical JSON snapshots (RFC 8785 style, sorted keys) of eligible active participants (ID and department only), available prizes (with category, scene and who can win) and the winner rules, hashes each with SHA-256, generates a 32-byte server seed, stores only its commitment and an AES-256-GCM ciphertext bound to the preparation ID, and computes a pre-draw manifest hash. Only one open preparation (draft, frozen or drawing) per event, enforced by a partial unique index. |
| Winner rules | Once per raffle, once per category, or no limit. After a reset, the voided winner is excluded from the redraw of that prize by default, or kept in the pool. Each rule compiles to the `exclusivity_key` that the existing unique index enforces. |
| Who can win | Per prize, an optional list of departments (case-insensitive). Edited on the prize page and frozen into the prize snapshot. |
| Freeze | Re-snapshots the live data under the event roster lock. If anything changed since the draft, the draft is refreshed and the freeze is refused so the admin reviews the new manifest. The freeze also refuses if the manifest differs from the one the admin was shown. Requires at least one participant and one prize. Locks participants, prizes, categories and imports. |
| Draws | Candidates now come from the frozen snapshot, filtered by the prize's departments, the winner rule and the reset history, through one pure function shared by the server and the verifier. Each draw still re-checks the live roster against the frozen hash and the stored snapshots against their hashes. The console sends the slot and its reset generation, so a double click or a refresh replays the same draw, and an out-of-date console is refused instead of drawing a different slot. |
| Reset current item | A recorded correction (category from winner absent, not eligible, data error, technical issue, other, plus a public reason) voids the winner and the draw and reopens the slot. Idempotent per draw. A pending draw can be reset only a minute after its beacon round was due, so a drand outage cannot block the event. Refused while another draw is pending. |
| Complete, cancel, Fresh Start | Complete ends drawing and reveals the seed. Cancel works on a draft, or on a frozen raffle with no draws, and reveals the seed of a frozen one. Fresh Start supersedes a frozen or drawing raffle with a reason, reveals its seed, and opens a new draft (version + 1) from the current data; repeating it returns the same successor. |
| Database backstops | Triggers make frozen snapshot columns, the seed commitment and a revealed seed immutable, allow only the legal status moves, block deletes of preparations, draws and winners, keep committed draw evidence fixed, allow a draw or winner to be voided only when a correction row exists, and make corrections append-only. A transaction-local `pcascade.allow_purge` setting lets the database verification script remove its scratch data. |
| Verifier | `verifyBundle` checks snapshot hashes, the manifest, the revealed seed against its commitment, every drand BLS signature, every candidate list, and recomputes every winner. It runs in the browser on `/verify/[preparationId]`, and offline with `npm run verify:bundle -- bundle.json`. |
| Public verify page | Visible once the event is published and the raffle is frozen. Shows the manifest, the rules, every draw and every reset with its reason, says plainly that resets are unlimited and what the page cannot prove, and offers the bundle download. Winner names appear only after the raffle is closed. |
| Admin pages | Raffle tab with history and the prepare form; manifest page with freeze, rules, cancel, complete and Fresh Start; draw console with per-slot draw, retry beacon, reset and the full reset trail. |

## Verified

| Check | Result |
|---|---|
| Automated tests | 183 passing (28 new): 18 lifecycle integration tests (prepare, stale draft, freeze, rules, department and per-category selection, stale console, reset with reason, voided-winner rule, stuck pending draw, 20 racing resets, complete, Fresh Start, cancel, database backstops, audit chain) and 10 domain unit tests (snapshot determinism, candidate rules, verifier tamper cases, seed vault). The 21 Phase 0 draw tests were moved onto real sealed snapshots, and the reproduction test now goes through the verifier, including a tampered winner. |
| Mutation checks | 17 of 17 caught. The first run missed one (reset timing `<` changed to `<=`), so a unit case was added for that boundary, and it is now caught. The rest: voided-winner exclusion, per-category grouping, department filter, live roster check, stale slot check, both freeze guards, reset idempotency, stuck-draw grace, seed reveal on complete, Fresh Start idempotency, verifier trusting the recorded winner, verifier skipping the seed commitment, seed vault without associated data, and the snapshot and winner-void triggers |
| HTTP smoke | 66/66, including the public verify page and bundle (seed withheld before the end), 404 for a draft event raffle and bad IDs, and anonymous and signed-in access to the three raffle pages |
| Browser walk-through | 13 participants in 4 departments, a 2-winner gift card and a TV limited to HR and IT through the new editor. A participant added behind the draft was caught at freeze, the draft refreshed, then frozen. Four draws against live drand quicknet rounds; one reset as winner absent with a reason; the redraw had 12 candidates (reset winner excluded); the TV drew only from HR and IT (6 candidates). Completed, then the verify page reproduced every draw in the browser, and `npm run verify:bundle` reproduced the downloaded bundle and failed a copy with one altered index. |

## Problems found and fixed during this phase

1. The eligibility editor remounted after saving and lost its confirmation message.
2. The smoke test looked for literal text that React splits with comment markers.

## Decisions taken

- The participant snapshot holds only participant IDs and departments, so the public bundle exposes no names, employee numbers or emails. Winner names are shown on the verify page only after the raffle closes.
- Resetting a stuck pending draw is allowed one minute after its beacon round was due. Without this, a long drand outage would block Complete and Fresh Start.
- A winner reset from one prize can still win a different prize (the reset rule applies to the same prize only). This happened in the walk-through. See the open question below.
- Imported photos replaced by an update import still stay until that import is reverted or the event is cleaned up. Moved to Phase 7 as a cleanup task, because removing them earlier would break import revert.

## Open question

Should "winner absent" remove that person from every remaining prize of the raffle, not only the prize they were reset from?

## Deploy note

Migration `20261121120000_raffle_engine` must be applied to Neon (`npm run db:migrate`) before this phase is pushed.

## Carry-overs

| Item | When |
|---|---|
| Presentation cursor, reveal gating and the director console controls for the big screen | Phase 4 |
| Public winners page (active raffle only, D12) | Phase 4 |
| Printable manifest and post-draw report | Phase 4 |
| Photos orphaned by update imports | Phase 7 |
