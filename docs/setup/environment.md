# Environment variables

PCASCADE reads its configuration from environment variables. Locally they live in `.env.local` (never committed). On Vercel they are set in **Project → Settings → Environment Variables**. `.env.example` lists every name with no values and is the file that is committed.

The app validates these at runtime (`src/lib/env.ts`) and fails with a message naming each missing or invalid variable. It never prints the values.

| Variable | Required | Where it comes from | Example shape |
|---|---|---|---|
| `DATABASE_URL` | Yes | Neon console → your project → **Connect** → connection string with **Connection pooling ON** (host contains `-pooler`). Used by the app at runtime. | `postgresql://USER:PASSWORD@ep-xxxx-pooler.REGION.aws.neon.tech/neondb?sslmode=require` |
| `DIRECT_URL` | Yes for migrations | Same Neon screen with **Connection pooling OFF** (no `-pooler` in the host). Used only by `prisma migrate`. | `postgresql://USER:PASSWORD@ep-xxxx.REGION.aws.neon.tech/neondb?sslmode=require` |
| `RAFFLE_SEED_ENCRYPTION_KEY` | Yes | Generate it yourself (command below). Encrypts each raffle's secret seed at rest. Use a **different** key for local and for Vercel, and never change the production key while a raffle is frozen. | 44-character base64 string |
| `APP_URL` | Yes | Your site's public origin. Used for same-origin checks on admin actions. | `http://localhost:3000` locally, `https://<project>.vercel.app` on Vercel |
| `DRAND_RELAYS` | No | Public drand relays for the randomness beacon. Leave the default unless a relay is retired. | `https://api.drand.sh,https://api2.drand.sh,https://drand.cloudflare.com` |

Generate an encryption key:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Test database

Integration tests use a disposable PostgreSQL 17 container, configured in `.env.test` (`TEST_DATABASE_URL`). The test setup wipes that database on every run and **refuses to run against any host other than localhost**, so it can never touch Neon.

```powershell
npm run db:test:up
npm test
npm run db:test:down
```

## First deployment checklist

1. Fill `DATABASE_URL`, `DIRECT_URL`, `RAFFLE_SEED_ENCRYPTION_KEY` and `APP_URL` in `.env.local`.
2. Apply migrations to Neon: `npm run db:migrate`.
3. In Vercel, add the same four variables (with a separate encryption key and the Vercel `APP_URL`) for the Production environment.
4. Deploy. `npm run build` runs `prisma generate` before `next build`.
5. Create the administrator once: `npm run admin:bootstrap`. It asks for the password twice without echoing it and refuses to run if an administrator already exists.

## Administrator recovery

If the password is lost, run `npm run admin:bootstrap -- --reset` with database access. It replaces the password, signs out every session and records the reset in the audit log.
