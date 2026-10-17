# SpendScope

Privacy-first personal finance analytics. Import a CSV from your bank, categorise
your spending, set budgets, and explore your trends — **entirely on your own
machine**. There is no external service, no telemetry, and no cloud account.

```text
CSV import → column mapping → validation & duplicate detection → categorisation → budgets → analytics
```

## Highlights

- **Dashboard** with income, expenses, net cash flow and savings-rate metrics,
  each compared with the previous period, plus charts and rule-based insights.
- **Transaction management**: create, view, edit, filter, sort, paginate,
  review-flag and delete; every filter is encoded in the URL so a view is
  shareable and reload-safe.
- **CSV import wizard**: upload, confirm the detected columns, review every row
  (valid, invalid, duplicate) before anything is stored, then import. Exact
  duplicates are skipped by default; possible duplicates are flagged.
- **Categories** for income and expenses, with lifetime totals, rename, recolour,
  reclassify (only while unused) and safe deletion (reassign or uncategorise).
- **Budgets** per month, per expense category, plus one total monthly budget, with
  progress bars and on-track / approaching / exceeded states.
- **Settings**: currency (display-only, never converts amounts), locale, default
  period, theme, sample data, and a guarded workspace reset.
- **Accessible & responsive**: keyboard-navigable native controls, visible labels,
  skip link, colour never the sole signal, and a light/dark theme applied before
  first paint.

## Technology

| Layer     | Choices                                                                 |
| --------- | ----------------------------------------------------------------------- |
| Frontend  | React 19, TypeScript (strict), Vite, Tailwind CSS v4, Lucide, Recharts, React Router, TanStack Query, React Hook Form + Zod, sonner |
| Backend   | Node.js, Express 5, Zod validation, Prisma ORM, structured logging (pino) |
| Database  | PostgreSQL, decimal money columns, committed migrations, idempotent seed |
| Shared    | `@spendscope/shared` — enums, Zod schemas, DTO types, money/date/period helpers, formatting |
| Testing   | Vitest + React Testing Library (unit/component), Supertest + real PostgreSQL (API integration), Playwright (end-to-end) |

## Repository layout

```text
spendscope/
├── apps/
│   ├── api/          Express + Prisma API, migrations, seed, integration tests
│   └── web/          React SPA, component tests, Playwright e2e
├── packages/
│   └── shared/       Types, Zod schemas, money/date formatting
├── docs/             Local Postgres, data model, financial rules, decisions, security
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
twice never duplicates data and never touches rows you imported.

### 5. Run

```bash
npm run dev
```

- Web app: <http://localhost:5173>
- API: <http://localhost:4000/api/v1> (health at `/api/v1/health`)

The Vite dev server proxies `/api` to the API, so no CORS configuration is
needed in development.

## Commands

| Command              | What it does                                                        |
| -------------------- | ------------------------------------------------------------------- |
| `npm run dev`        | Start the API and web app together                                  |
| `npm run build`      | Type-check and production-build the API (tsup) and web (Vite)       |
| `npm run typecheck`  | Type-check every workspace                                          |
| `npm run lint`       | ESLint across the repo                                              |
| `npm test`           | Run all unit + integration tests (shared, API, web)                 |
| `npm run test:e2e`   | Run Playwright end-to-end tests (needs the DB + servers)            |
| `npm run db:generate`| Generate the Prisma client (after cloning or changing the schema)   |
| `npm run db:migrate` | Create/apply a migration in development                             |
| `npm run db:deploy`  | Apply committed migrations                                          |
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
```

- **Shared** (`packages/shared`): money, date, period and formatting helpers.
- **API unit**: CSV parsing, fingerprinting, categorisation, import validation.
- **API integration**: health, transactions, categories, budgets, imports,
  analytics and settings against a real PostgreSQL database (`TEST_DATABASE_URL`,
  wiped between runs).
- **Web component**: dashboard, transactions, import wizard, categories and
  settings, with the network layer stubbed.
- **End-to-end** (`apps/web/e2e`): a real CSV import through the running stack,
  plus an invalid-file scenario.

The end-to-end tests require the local database to be running and will start the
API and web dev servers automatically.

## Documentation

- [`docs/LOCAL_POSTGRES.md`](docs/LOCAL_POSTGRES.md) — the local PostgreSQL cluster.
- [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) — tables, constraints and indexes.
- [`docs/FINANCIAL_RULES.md`](docs/FINANCIAL_RULES.md) — how every metric is calculated.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — notable design decisions and trade-offs.
- [`docs/SECURITY.md`](docs/SECURITY.md) — security posture and limitations.

## Limitations

See the *Known limitations* section of the final report and
[`docs/SECURITY.md`](docs/SECURITY.md). In short: SpendScope is a
single-user, local-first application. There is **no authentication**, the API
binds to localhost, and it must never be exposed to a network or the public
internet as-is.
