# Phase 0 report (2026-11-20)

Goal: prove the risky parts of the stack on the free tier before building features.

## Proven

| Area | Evidence |
|---|---|
| Next.js 16 on Vercel Hobby | `https://pcascade.vercel.app`, functions pinned to `sin1` (Singapore) via `vercel.json` |
| Prisma 7 + Neon (pooled) | `npm run db:verify` against Neon Singapore: 50 racing draw requests reserve exactly one draw; 10 concurrent `runDraw` calls with one key commit exactly one winner |
| Commit-then-reveal draw | `requestDraw` commits to drand round `now + 2` before it exists; `completeDraw` accepts only that round, checks the seed against its freeze-time commitment and the roster against its freeze-time digest |
| drand quicknet | Public key pinned and confirmed identical on three relays; BLS verification, stale-round and forged-signature rejection tested |
| Unbiased selection | Rejection sampling with an injectable stream; known-answer vector checked against an independent implementation of the written spec |
| Photos in Postgres | Bytes and metadata derived from content; draft events not served; CDN copy removed by tag purge (verified live: deleted photo returns 404 after purge) |
| Tests | 62 unit and integration tests; mutation checks confirm removing the seed check, the round check or the rejection limit makes tests fail |

## Independent review

A blind review found one critical and four important issues. All were fixed in this phase:

1. Seed and beacon round were not bound to the draw → two-step draw with a committed future round and seed commitment check.
2. Candidates came from the live table → roster digest at freeze, rechecked at request and completion.
3. Idempotency key reuse across prizes returned the wrong draw → `IDEMPOTENCY_CONFLICT`.
4. `latest` drand round was not checked for freshness → stale rounds rejected.
5. Long-lived public cache on visibility-dependent photos → 5-minute browser cache, long CDN cache with tag purge.

Minor items fixed: JPEG/WebP/PNG length checks, strict base64 key validation, relay URLs with credentials rejected, 304 without loading photo bytes, rejection-branch test.

## Carried into later phases

| Item | Phase |
|---|---|
| When an event leaves a public status, purge `event-media-<eventId>` via `purgeCdnCache` | 1 (events) |
| Freeze must compute `participantsSha256` with `rosterDigest` and store `seedCommitment(seed)` with the seed encrypted under `RAFFLE_SEED_ENCRYPTION_KEY` | 3 (raffle engine) |
| Replace the interim roster digest with full canonical snapshots (participants, prizes, rules) | 3 |
| Browser re-encodes photos to WebP before upload, stripping EXIF/GPS | 2 (imports) |
| Admin photo deletion calls `deleteImage(db, id, purgeCdnCache)` | 2 |
| Give local development its own Neon branch before the first real event | before go-live |
| `effect` pinned to 3.22.5 through `overrides` (ReDoS fix in a Prisma CLI dependency); remove once Prisma ships it | on next Prisma upgrade |
