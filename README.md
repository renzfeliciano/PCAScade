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
npm run dev
```

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

## Docs

- [Architecture review](docs/architecture/architecture-review.html)
- [Environment variables](docs/setup/environment.md)
