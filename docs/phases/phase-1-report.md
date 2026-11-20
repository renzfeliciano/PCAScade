# Phase 1 report (2026-11-20)

Goal: application foundation. Single-administrator access, tamper-evident audit history, event management, and separate public, admin and presentation surfaces with the PCASCADE identity.

## Built

| Area | What exists |
|---|---|
| Audit chain | `audit_log` table, append-only by trigger (update, delete, truncate refused). Each entry hashes `PCASCADE/audit/v1`, the previous hash and the RFC 8785 canonical JSON of the entry. Appends are serialized by one advisory lock and run inside the business transaction, so an action and its audit entry commit or roll back together. `/admin/audit-logs` verifies the whole chain on every load. |
| Administrator | Exactly one row, enforced by `CHECK (id = 1)`. Created only by `npm run admin:bootstrap` (hidden prompt, refuses if one exists, `--reset` replaces the password and signs out every session). No sign-up route exists. |
| Passwords | scrypt N=2^17, r=8, p=1, 16-byte salt, constant-time compare, rehash on parameter change, minimum 12 characters plus a common-password list. |
| Sessions | 32 random bytes in a `__Host-pcascade-session` cookie (HttpOnly, Secure, SameSite=Lax). The database stores only SHA-256 of the token. 8-hour idle and 7-day absolute expiry. Password change signs out other sessions. |
| Login throttling | Per client (hashed IP): 5 free failures in an hour, then 1 minute doubling to 1 hour. Global brake after 50 failures in 15 minutes. Throttled attempts are not even checked. |
| Authorization | Console layout, every console page and every server action call `requireAdmin()` themselves. Admin route handlers reject posts without a same-site `Origin`. A unit test fails the build if any action or route skips these checks. |
| Events | Create, edit, publish, go live, close, archive, back to draft, with an explicit transition table and confirm-before-change UI. Dates entered in Manila time. Six accent colours inside the PCASCADE palette, all WCAG AA for text. Leaving public status purges the event's cached photos from the CDN. |
| Surfaces | Public (dark site look): `/`, `/events`, `/events/[slug]`, `/about`. Admin (light console): `/admin`, `/admin/events`, `/admin/events/new`, `/admin/events/[id]`, `/admin/audit-logs`, `/admin/settings`. Presentation lobby: `/presentation/[slug]`, full-screen, read-only, published or live events only. |
| Headers | `nosniff`, referrer policy, permissions policy everywhere; admin also `X-Frame-Options: DENY`, `no-store`, `noindex`. |

## Verified

| Check | Result |
|---|---|
| Unit and integration tests | 112 passing, against PostgreSQL 17 |
| Mutation checks | Removing `requireAdmin()` from an action, the audit-chain lock, session revocation on password change, the login throttle, the CDN purge on unpublish, or the Origin check each makes a test fail |
| HTTP smoke (`npm run smoke:http` against a production build) | 30/30: public pages, drafts hidden (404), anonymous admin redirected, missing or foreign Origin refused, wrong password refused, cookie flags correct, signed-in pages load, audit chain intact, logout revokes the cookie |
| Browser walk-through | Sign in, create event (validation error keeps typed values), publish, go live, public page and presentation lobby, audit log, phone width |
| Tamper detection | An edited entry is reported at its exact sequence number; a deleted entry is reported at the next one |

## Problems found and fixed during this phase

1. `create-next-app` 16.4 turned on `cacheComponents`. Turned off: every page here reads live data, and stale raffle state is worse than a slower page. Pages use `dynamic = "force-dynamic"`.
2. `canonicalize` 4 is ESM-only and broke the terminal scripts; replaced by a 20-line RFC 8785 serializer tested against the RFC's own examples.
3. Postgres `restrict_violation` surfaced in Prisma as a misleading foreign-key error; the audit trigger now raises a plain exception with a clear message.
4. React 19 cleared the event form after a validation error; the action now returns the submitted values.
5. The status confirmation stayed open after a successful change; it now resets when the status changes.
6. Several accent colours failed text contrast; each accent now has fill, on-fill and on-dark shades, enforced by a test.
7. Audit sequence numbers can skip after a rolled-back action; the page now explains that the hash links, not the numbers, prove completeness.

## Known limits and carry-overs

| Item | When |
|---|---|
| The logo and wordmark are placeholders in `src/components/brand/brand-mark.tsx` | When the real assets arrive |
| `/admin/audit-logs` re-verifies the full chain on every load; fine for thousands of entries, needs a checkpoint once the log is large | Phase 7 |
| The shadcn CLI (dev dependency) pulls an old `minimatch` with a moderate ReDoS advisory; not shipped or used at runtime (`npm audit --omit=dev` is clean) | When shadcn updates |
| Remaining admin pages from the brief (participants, imports, prizes, categories, raffle sessions, winners, animations, media) | Phases 2 to 5 |
