# PCASCADE

Every Reveal Builds Excitement.

Construction-themed raffle and winner-reveal platform for PCAS events. Next.js App Router, TypeScript, PostgreSQL (Neon) via Prisma, deployed on Vercel.

## Getting started

```powershell
npm install
copy .env.example .env.local
```

Fill in `.env.local` as described in [docs/setup/environment.md](docs/setup/environment.md), then:

```powershell
npm run db:migrate
npm run admin:bootstrap
npm run dev
```

Sign in at `/admin/login`.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Local development server |
| `npm run build` | Generate the Prisma client and build for production |
| `npm run typecheck` / `npm run lint` | Static checks |
| `npm run db:migrate` | Apply migrations to the database in `DIRECT_URL` |
| `npm run db:migrate:create -- --name <name>` | Create a new migration without applying it |
| `npm run db:test:up` / `npm run db:test:down` | Start or stop the local test PostgreSQL container |
| `npm test` | Unit and integration tests |
| `npm run admin:bootstrap` | Create the single administrator (`-- --reset` to replace a lost password) |
| `npm run db:verify` | Check concurrent draws and the drand beacon against the database in `.env.local` |
| `npm run verify:bundle -- <bundle.json>` | Check a downloaded verification bundle offline: snapshots, manifest, seed, drand signatures and every winner |
| `npm run smoke:http` | HTTP checks against a running build (`SMOKE_BASE_URL`, `SMOKE_ADMIN_PASSWORD`) |
| `npm run test:e2e` | Browser tests (Playwright) for the presentation, including a refresh during a reveal. Starts its own dev server on port 3210 against the local test database and refuses any other database |
| `npx tsx tests/e2e/make-import-fixtures.mts <dir>` | Write messy sample participant and prize sheets with photo ZIPs for trying the import wizard |

## Docs

- [Architecture review](docs/architecture/architecture-review.html)
- [Environment variables](docs/setup/environment.md)
- [Phase 0 report](docs/phases/phase-0-report.md)
- [Phase 1 report](docs/phases/phase-1-report.md)
- [Phase 2A report](docs/phases/phase-2a-report.md)
- [Phase 2B report](docs/phases/phase-2b-report.md)
- [Phase 3 report](docs/phases/phase-3-report.md)
- [Phase 4 report](docs/phases/phase-4-report.md)
