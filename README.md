# SpendScope

Privacy-first personal finance analytics. Import a CSV from your bank, categorise
your spending, set budgets, and explore your trends — **on your own machine, or on
a server you control**. There is no external service, no telemetry, and no cloud
account, and no data leaves your database.

```text
CSV import → column mapping → validation & duplicate detection → categorisation → budgets → analytics
```

## Highlights

- **Accounts and sessions**: sign-in with scrypt-hashed passwords, opaque
  `HttpOnly` session cookies, session listing, and one workspace per account.
  Every data route requires authentication and is scoped to the session's
  workspace; one account can never see another's rows.
- **Dashboard** with income, expenses, net cash flow and savings-rate metrics,
  each compared with the previous period, plus charts and rule-based insights.
- **Transaction management**: create, view, edit, filter, sort, paginate,
  review-flag and delete; every filter is encoded in the URL so a view is
  shareable and reload-safe.
- **CSV import wizard**: upload, confirm the detected columns, review every row
  (valid, invalid, duplicate) before anything is stored, then import. Exact
  duplicates are skipped by default; possible duplicates are flagged. Committing
  the same preview twice is idempotent — it never imports the rows a second time.
- **Refunds** linked to the expense they reverse: the refund inherits the
  original's category and currency, and over-refunding is rejected.
- **Account transfers** that can be paired manually, so the two sides of one
  movement are grouped. Transfers never count as income or expense.
- **Configurable category rules**: ordered, kind-safe, and they only fill a
  category that is missing — they never overwrite your data. A retroactive apply
  is a dry run by default.
- **Recurring transaction detection** with an explanation for every series and
  the ability to dismiss one.
- **Categories** for income and expenses, with lifetime totals, rename, recolour,
  reclassify (only while unused) and safe deletion (reassign or uncategorise).
- **Budgets** per month, per expense category, plus one total monthly budget, with
  progress bars and on-track / approaching / exceeded states.
- **Export and backup**: a filtered CSV export (formula-injection guarded) and a
  portable, restorable JSON backup of a workspace. Plus a full account deletion
  that requires both a confirmation token and your password.
- **Currency handling without lying about totals**: the base currency never
  converts, so a foreign-currency row is kept, labelled and **excluded** from
  every total — and the dashboard tells you exactly which rows were left out.
- **Settings**: base currency, locale, default period, theme, sample data, and a
  guarded workspace reset.
- **Accessible & responsive**: keyboard-navigable native controls, visible labels,
  skip link, colour never the sole signal, and a light/dark theme applied before
  first paint.

## Technology

| Layer     | Choices                                                                 |
| --------- | ----------------------------------------------------------------------- |
| Frontend  | React 19, TypeScript (strict), Vite, Tailwind CSS v4, Lucide, Recharts, React Router, TanStack Query, React Hook Form + Zod, sonner |
| Backend   | Node.js, Express 5, Zod validation, Prisma ORM, `node:crypto` scrypt + cookie sessions, helmet, rate limiting, structured logging (pino) |
| Database  | PostgreSQL, decimal money columns, committed migrations, explicit seed |
| Shared    | `@spendscope/shared` — enums, Zod schemas, DTO types, money/date/period helpers, formatting |
| Testing   | Vitest + React Testing Library (unit/component), Supertest + real PostgreSQL (API integration), Playwright (end-to-end) |
| Delivery  | GitHub Actions CI, multi-stage Dockerfiles, nginx same-origin serving, docker-compose production-shaped stack |

## Repository layout

```text
spendscope/
├── apps/
│   ├── api/          Express + Prisma API, migrations, seed, integration tests, Dockerfile
│   └── web/          React SPA, component tests, Playwright e2e, Dockerfile + nginx config
├── packages/
│   └── shared/       Types, Zod schemas, money/date formatting
├── docs/             Local Postgres, data model, financial rules, decisions, security,
│                     deployment, backup/restore, production test report, audit
├── .github/workflows/ci.yml
├── docker-compose.yml
├── .env.example
└── package.json      npm workspaces + orchestration scripts
```

## Getting started

### 1. Prerequisites

- Node.js **≥ 20.19**
- A local PostgreSQL server (the project is developed against PostgreSQL 18).
  See [`docs/LOCAL_POSTGRES.md`](docs/LOCAL_POSTGRES.md) for the exact local
  cluster setup (private data directory on port 5433, trust auth, local only).

### 2. Install

```bash
npm install
```

### 3. Configure the environment

```bash
cp .env.example .env
```

`.env` is git-ignored. Edit `DATABASE_URL` (and `TEST_DATABASE_URL` for the test
suite) to match your PostgreSQL instance. Every variable is documented inside
`.env.example`.

### 4. Create the schema and seed

```bash
npm run db:deploy        # apply committed migrations
npm run db:seed          # default workspace + categories + sample data
# or, for an empty dashboard:
SEED_DEMO=0 npm run db:seed
```

`db:seed` is idempotent: it removes previous sample rows first, so running it
twice never duplicates data and never touches rows you imported. It is
development tooling — never run it against a production database.

### 5. Run

```bash
npm run dev
```

- Web app: <http://localhost:5173>
- API: <http://localhost:4000/api/v1> (health at `/api/v1/health`)

The Vite dev server proxies `/api` to the API, so no CORS configuration is
needed in development.

### 6. Create your account

Open <http://localhost:5173> and register — you are redirected to sign-in first,
because every data route requires a session. The first account created against a
fresh database claims the workspace that `db:seed` created (when
`BOOTSTRAP_DEFAULT_WORKSPACE=true`, which is the development default and must be
`false` in production). Any later account gets its own empty workspace.

## Commands

| Command              | What it does                                                        |
| -------------------- | ------------------------------------------------------------------- |
| `npm run dev`        | Start the API and web app together                                  |
| `npm run build`      | Type-check and production-build the API (tsup) and web (Vite)       |
| `npm run start`      | Run the built API from `apps/api/dist`                              |
| `npm run start:web`   | Run the built web app (`apps/web/dist` + `/api` proxy) from the repo root |
| `npm run typecheck`  | Type-check every workspace                                          |
| `npm run lint`       | ESLint across the repo                                              |
| `npm test`           | Run all unit + integration tests (shared, API, web)                 |
| `npm run test:e2e`   | Run Playwright end-to-end tests (needs the DB + servers)            |
| `npm run db:generate`| Generate the Prisma client (after cloning or changing the schema)   |
| `npm run db:migrate` | Create/apply a migration in development                             |
| `npm run db:deploy`  | Apply committed migrations                                          |
| `npm run db:test:deploy` | Apply committed migrations to the test database                 |
| `npm run db:seed`    | Seed the workspace, categories and (optionally) sample data         |
| `npm run db:reset`   | Drop, recreate and re-migrate the *development* database            |
| `npm run db:studio`  | Open Prisma Studio                                                  |

> The Prisma client is generated into `apps/api/src/generated/prisma` and is
> git-ignored. Run `npm run db:generate` once after cloning, before type-checking
> or running the API.

## Testing

```bash
npm test                                   # everything (unit + API integration)
npm run test:e2e                           # Playwright (full stack)
npm audit --omit=dev                       # dependency check
```

**316 tests pass**: shared 28, API 238 (22 files), web 60, plus 7 Playwright
end-to-end tests.

- **Shared** (`packages/shared`): money, date, period and formatting helpers.
- **API unit**: CSV parsing, fingerprinting, categorisation, refunds, transfers,
  recurring detection, aggregation and production configuration validation.
- **API integration**: authentication, workspace isolation with two real
  accounts, transactions, categories, category rules, budgets, imports
  (including idempotent replay), analytics, exports, backup/restore, currency and
  settings — all against a real PostgreSQL database (`TEST_DATABASE_URL`, wiped
  between runs). There is no authentication bypass and no mocked database.
- **Web component**: dashboard, transactions, import wizard, categories and
  settings, with the network layer stubbed.
- **End-to-end** (`apps/web/e2e`): sign-in redirect, anonymous access rejection,
  wrong password, sign-in/sign-out, the account page, a real CSV import, and an
  invalid-file scenario.

The end-to-end tests require the local database to be running and will start the
API and web dev servers automatically. Exact results, timings and the
production-shaped smoke test are in
[`docs/PRODUCTION_TEST_REPORT.md`](docs/PRODUCTION_TEST_REPORT.md).

## Documentation

- [`docs/LOCAL_POSTGRES.md`](docs/LOCAL_POSTGRES.md) — the local PostgreSQL cluster.
- [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) — tables, constraints and indexes.
- [`docs/FINANCIAL_RULES.md`](docs/FINANCIAL_RULES.md) — how every metric is calculated.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — notable design decisions and trade-offs.
- [`docs/SECURITY.md`](docs/SECURITY.md) — security posture, data inventory and limitations.
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — architecture, configuration, migrations, rollback, and a step-by-step Railway deployment guide.
- [`docs/DATA_BACKUP_AND_RESTORE.md`](docs/DATA_BACKUP_AND_RESTORE.md) — backup policy and the restore drill.
- [`docs/PRODUCTION_TEST_REPORT.md`](docs/PRODUCTION_TEST_REPORT.md) — executed checks and load timings.
- [`docs/PRODUCTION_READINESS_AUDIT.md`](docs/PRODUCTION_READINESS_AUDIT.md) — the requirement-by-requirement audit.

## Limitations

SpendScope is a **single-user-per-account** application with **no currency
conversion**, and it has **not been deployed** — no production URL exists, so no
claim of production readiness for a live environment is made. Everything that can
be verified locally has been; the remaining steps need a provider, a domain and
credentials.

Before exposing it to any network, follow the hardening checklist in
[`docs/SECURITY.md`](docs/SECURITY.md) and the deployment checklist in
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). In particular: serve it over HTTPS,
use a least-privilege database role, keep `BOOTSTRAP_DEFAULT_WORKSPACE=false`,
and decide whether public registration stays open. Railway is the initial
hosting target: the step-by-step guide (services, build/start commands,
variables, migrations, smoke tests, rollback) is in
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
