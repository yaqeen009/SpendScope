# Production test report

Evidence collected on 2026-10-17 against the repository at the commit
`chore(production): security hardening, CI, containers, deployment and audit`,
extended by the Railway deployment preparation work described below.

**Verdict:** the application passes every check that can be run on this machine,
including a production-shaped end-to-end smoke test against a real PostgreSQL
database and a full run of the Railway service topology (web service proxying
`/api` to the API). **No public deployment exists, so deployment is unverified
and is not claimed.** See [Not tested](#not-tested).

## Environment

| Item | Value |
| ---- | ----- |
| Host | macOS (aarch64), local development machine |
| Node.js | v24.21.0 (CI targets Node 22; `engines` requires ≥20.19.0) |
| npm | 11.19.0 |
| PostgreSQL | 18.6, local cluster on port 5433 |
| API | Express 5.3.0, Prisma 7.10.1, `@prisma/adapter-pg`, pino 10.4.0, helmet 8.3.0, zod 4.6.7 |
| Web | React 19.3.1, Vite, Tailwind |

## Automated tests

| Suite | Command | Files | Result |
| ----- | ------- | ----- | ------ |
| Shared package | `npm test` (workspace `@spendscope/shared`) | 3 | **28 passed** |
| API unit + integration | `npx vitest run` in `apps/api` (real PostgreSQL) | 21 | **233 passed** |
| Web component | `npm test` (workspace `@spendscope/web`, incl. `server.test.mjs`) | 8 | **50 passed** |
| **Total** | `npm test` | 32 | **311 passed, 0 failed** |
| End-to-end (real browser, real API, real database) | `npm run test:e2e` | 2 | **7 passed** |

The API suite runs against a dedicated `TEST_DATABASE_URL` database that is
truncated between tests. It tests through the real HTTP API with real cookies —
there is no authentication bypass and no mocked database. Coverage includes
workspace isolation with two accounts, refund rules, transfer pairing, category
rule conflicts, import idempotency, CSV formula injection, backup/restore
validation, currency exclusion, expired import previews, decimal and date
boundaries, and production configuration validation.

End-to-end run, detail:

```
  ✓ an anonymous visitor is redirected to the sign-in screen (1.0s)
  ✓ the API refuses anonymous data requests (65ms)
  ✓ a wrong password shows an error and does not sign in (929ms)
  ✓ signing in reaches the overview and signing out ends the session (1.4s)
  ✓ a signed-in user can view the account page (839ms)
  ✓ imports a valid CSV through the wizard (2.3s)
  ✓ reports invalid rows and refuses to import them when blocked (907ms)
  7 passed (8.4s)
```

## Static checks and build

| Check | Command | Result |
| ----- | ------- | ------ |
| Type checking | `npm run typecheck` (shared + api + web, `tsc --noEmit`) | **clean**, no errors |
| Lint | `npm run lint` (ESLint) | **0 errors**, 19 warnings |
| Production build | `npm run build` (tsup API bundle + Vite web bundle) | **success**; API `dist/server.js` 270 kB, web `index-*.js` 493 kB (148 kB gzipped) |
| Dependency audit | `npm audit --omit=dev` | **0 vulnerabilities** |

The 19 lint warnings are all `react-refresh/only-export-components` (component
files that also export a non-component helper) and one `react-hooks` advisory
about a third-party library. There are no `any` types, no disabled rules and no
errors. `npm run format:check` reports a pre-existing formatting gap across 122
files (including files untouched by this work); it is deliberately **not** gated
in CI, and the gap is recorded rather than hidden.

## Database

| Check | Command | Result |
| ----- | ------- | ------ |
| Migrations apply to an **empty** database | `DATABASE_URL=…clean_check npx prisma migrate deploy` | 9 migrations applied, 13 tables created, `migrate status` → `Database schema is up to date!` |
| Migrations apply to an **existing** database with data | `npx prisma migrate deploy` on the development database | applied incrementally, no data loss |
| Application starts against the migrated empty database | `node dist/server.js` with `NODE_ENV=production` | `GET /api/v1/health/ready` → `200 {"status":"ready","database":"up"}` |
| First registration on an empty database creates its own workspace | `POST /api/v1/auth/register` with `BOOTSTRAP_DEFAULT_WORKSPACE=false` | `workspace: Personal` created and owned by the new account |
| Restore drill (dump → scratch database → compare → boot) | see `docs/DATA_BACKUP_AND_RESTORE.md` | identical table list (13) and row counts; API booted against the restored copy |

## Production-shaped smoke test

The production build was run with `NODE_ENV=production` against a **restored
copy** of the database, with the production configuration guard active, real
session cookies, and every request sent over HTTP with an `Origin` header as a
browser would.

Command shape:

```bash
NODE_ENV=production PORT=4100 \
DATABASE_URL="postgresql://…/spendscope_restore_drill" \
CORS_ORIGIN="http://localhost:8080" TRUST_PROXY=1 \
SESSION_COOKIE_SECURE=false ALLOW_LOCAL_DATABASE_IN_PRODUCTION=true \
ALLOW_INSECURE_COOKIES=true BOOTSTRAP_DEFAULT_WORKSPACE=false \
node apps/api/dist/server.js
```

| # | Check | Observed result |
| - | ----- | --------------- |
| 1 | Configuration guard rejects an unsafe production config | **Refused to start** and named all four problems (loopback non-HTTPS origin, local database) |
| 2 | Liveness | `GET /api/v1/health` → `200` |
| 3 | Readiness | `GET /api/v1/health/ready` → `200 {"status":"ready","database":"up"}` |
| 4 | Request correlation | Every response carries `x-request-id`; a supplied `x-request-id: edge-trace-42` is echoed; an unsafe value is replaced |
| 5 | Registration | `POST /auth/register` → `201` with user + owned workspace; cookie is `HttpOnly` |
| 6 | Session | `GET /auth/me` → `200` with the session's user and workspace |
| 7 | CSRF | `POST /transactions` with `Origin: https://evil.example` → **`403 FORBIDDEN`**, no row written |
| 8 | Create (base currency) | `POST /transactions` → `201`, `currency: null` |
| 9 | Create (foreign currency) | `POST /transactions` with `currency: "USD"` → `201`, `currency: "USD"` |
| 10 | Financial integrity | Summary returned `income 5000.00`, `expenses 120.00`, `net 4880.00`, `transactionCount 2`, and `foreignCurrency: { count: 1, currencies: ["USD"], totals: [{ USD, expenses: "75.00" }] }` — the USD row is excluded **and reported**, not silently summed |
| 11 | CSV export | `GET /exports/transactions.csv` → `200 text/csv`, `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `currency` column resolved (`GHS` for base rows, `USD` for the foreign row) |
| 12 | Backup | `GET /exports/backup.json` → `200`, 3 transactions with `currency` preserved |
| 13 | Unauthenticated access | `GET /transactions` without a cookie → `401 UNAUTHORIZED` with a request id |
| 14 | Validation error shape | `GET /transactions/nope` → `400 VALIDATION_ERROR` with a field path and request id, no stack or SQL detail |
| 15 | Sign out | `POST /auth/logout` → `204`; the same cookie then → `401` |
| 16 | Log content | Access log lines contain only level, code, path, status, message — no description, merchant, amount or cookie value |
| 17 | Restart durability | The process was killed with `SIGKILL` (no graceful shutdown), a fresh process was started against the same database, and the **same session cookie** returned `200` from `/auth/me` with the previously created row still present (`search=Survives` → the row). The check account was then deleted through `DELETE /auth/me` (`{"workspaces":1}`) |

## Railway service topology smoke test

The Railway deployment shape was exercised locally: two separate processes
(`api` and `web`), only one public origin, `/api` proxied by the web service
exactly as `API_INTERNAL_URL` would on Railway. `apps/api/dist/server.js` was
started with `NODE_ENV=production` and the configuration guard active (the
deliberate local overrides), and `apps/web/server.mjs` with
`API_INTERNAL_URL=http://127.0.0.1:4100`. Every request below went through the web
origin, the way a browser would. The script ran **36 checks, 36 passed**; the
table records the ones that matter.

```bash
NODE_ENV=production PORT=4100 HOST=127.0.0.1 \
DATABASE_URL="postgresql://postgres@localhost:5433/spendscope?schema=public" \
CORS_ORIGIN="http://127.0.0.1:4101" \
ALLOW_LOCAL_DATABASE_IN_PRODUCTION=true ALLOW_INSECURE_COOKIES=true \
SESSION_COOKIE_SECURE=false BOOTSTRAP_DEFAULT_WORKSPACE=false \
TRUST_PROXY=1 LOG_LEVEL=info \
node apps/api/dist/server.js

PORT=4101 HOST=127.0.0.1 API_INTERNAL_URL=http://127.0.0.1:4100 \
HSTS_MAX_AGE=31536000 LOG_LEVEL=info \
node apps/web/server.mjs
```

| # | Check | Observed result |
| - | ----- | --------------- |
| 1 | Static SPA | `GET /` → `200`, `index.html` served |
| 2 | Security headers | CSP (`connect-src 'self'`), `X-Content-Type-Options: nosniff`, HSTS all present on every static response |
| 3 | SPA fallback | `/budgets` → `200 index.html` |
| 4 | Missing asset | `/assets/nope.js` → `404` (no fallback masking) |
| 5 | Directory traversal | raw `GET /assets/%2e%2e/%2e%2e/package.json` over a socket → **`404`**; normalised `/assets/../../package.json` serves the SPA shell, never a file outside the root |
| 6 | Health | `GET /health` → `200 {"status":"ok"}` |
| 7 | Proxy liveness | `GET /api/v1/health` → `200` through the proxy |
| 8 | Proxy readiness | `GET /api/v1/health/ready` → `200`, `database: "up"` |
| 9 | Anonymous read | `GET /api/v1/transactions` → `401` with `requestId` in the body |
| 10 | CSRF | `POST /api/v1/categories` with `Origin: https://evil.example` → **`403`**, nothing written |
| 11 | Registration | `POST /api/v1/auth/register` → `201`; the response `Set-Cookie` survived the proxy as its own header, `HttpOnly`, `SameSite=Lax` |
| 12 | Session | authenticated `GET /api/v1/transactions` → `200` |
| 13 | Workspace isolation | a second registered account cannot see the first account's category |
| 14 | Forwarded address | the API saw exactly one `X-Forwarded-For` entry equal to the real client address, so `TRUST_PROXY=1` is correct behind the web proxy |
| 15 | Request id | `x-request-id` echoed through the proxy |
| 16 | CSV import | template downloaded through the proxy → preview → commit → `created: 6` → the 6 rows readable afterwards |
| 17 | Import idempotency | replaying the same committed preview left the count at 6 — no duplicate rows |
| 18 | Startup mode | the web server logged `single-origin (proxying /api)`; the API logged `env: "production"` |
| 19 | No demo data | no `default workspace ready` line: `BOOTSTRAP_DEFAULT_WORKSPACE=false` held |
| 20 | Log content | the API log contains no password, no cookie value, no category name, no transaction description |

Two defects were found and fixed by this run:

1. **Session token in the request log.** Pino logs the response headers, so
   `res.headers["set-cookie"]` wrote the live session token to the log sink —
   anyone with log access could replay a session. Fixed by adding
   `res.headers["set-cookie"]`, `req.headers["set-cookie"]` and the matching
   wildcard paths to the redaction rules, exporting the rule list as
   `REDACT_PATHS` so a regression test can assert it, and adding a unit test
   that logs a realistic completion line and asserts no token survives.
2. **Method error on the web server.** `writeHead(status, [[k,v],…])` is not a
   supported form (header arrays must be flat); the proxy now uses
   `setHeader`, which also preserves multiple `Set-Cookie` values correctly.

## Performance and load

Workload: **50,000 transactions** in one workspace (a realistic multi-year
history), inserted into a scratch database, spread across 24 months with a
70/25/5 expense/income/transfer mix, 250 distinct merchants, and 15 MB of table
data. Timed with `curl -w '%{time_total}'` against the production build, warm
cache, on the local machine. These are single-request timings on one host, not a
load test.

| Endpoint | Time |
| -------- | ---- |
| `GET /analytics/summary` (24-month range) | 53 ms |
| `GET /analytics/summary` (this month) | 4–7 ms |
| `GET /analytics/timeseries` (24 months) | 4 ms |
| `GET /analytics/category-breakdown` | 3 ms |
| `GET /analytics/monthly-trend` (24 months) | 18 ms |
| `GET /analytics/dashboard` (a full dashboard load) | 36 ms |
| `GET /transactions?page=1&pageSize=50` | 10 ms |
| `GET /transactions?search=Merchant 123` | 23 ms |
| `GET /transactions?sortBy=amount&sortOrder=desc` | 8 ms |
| `GET /exports/transactions.csv` (50,000 rows, 4.9 MB) | 678 ms |
| `GET /exports/backup.json` (50,000 rows) | 542 ms |

Observations:

- Totals are computed with SQL `GROUP BY`/`SUM`, so a 24-month summary over
  50,000 rows is tens of milliseconds, and no endpoint loads all transactions
  into memory. Pagination is enforced on the list endpoint (page size 50 by
  default, 200 maximum).
- The export is the only endpoint bounded by payload size rather than query cost;
  it is capped at 50,000 rows and reports truncation with
  `X-Total-Truncated: true`.
- Limitations: one instance, one client, no concurrent load, local disk, and warm
  caches. Sustained concurrency and cold-cache behaviour were **not** measured.

## Continuous integration

`.github/workflows/ci.yml` is configured to run, on every push and pull request:
`npm ci`, a real PostgreSQL 16 service, test-database creation, `prisma generate`,
migrations against both databases, lint, typecheck, the full test suite, the
production build, and a second job that installs Chromium and runs the Playwright
suite.

**This workflow has not executed.** The repository has no GitHub remote and no
GitHub Actions runner is reachable from this machine, so there is no CI run to
report. The workflow file is validated as YAML and every command it runs was
executed locally with the same inputs, which is what the section above records.
The honest status is *configured, not run*.

## Container images

`apps/api/Dockerfile` (multi-stage: build, one-shot `migrate`, non-root runtime
with a health check), `apps/web/Dockerfile` (nginx serving the SPA and proxying
`/api`), `apps/web/nginx.conf`, `apps/web/security-headers.inc` and
`docker-compose.yml` are written but **were not built or run**: Docker is not
installed on this machine (`docker: command not found`). Every step the images
perform — `npm ci`, `prisma generate`, `npm run build`, `migrate deploy`, `node
dist/server.js`, health checks — was verified outside a container by the checks
above. Treat the image build as unverified.

`docker-compose.yml` is a production-shaped local stack, not a production
deployment: it uses a local database credential, `http://localhost:8080` as the
origin, and the two documented local overrides.

## Not tested

| Not tested | Why | Consequence |
| ---------- | --- | ----------- |
| A public deployment over HTTPS | No provider, domain, database or deployment credential was provided, and provisioning incurs cost without authorization | Deployment is **unverified**. No production URL exists. |
| The production smoke test from `PRODUCTION_READINESS.md` §15 against public URLs | Same | Same |
| A Railway deployment itself (services, pre-deploy migration, public domain) | No Railway account, project or billing authorization | The topology is verified locally (section above); the platform steps are documented but unexecuted |
| GitHub Actions CI execution | No GitHub remote or runner | CI is configured but has never run |
| Docker image build and compose stack | Docker is not installed on this machine | Image build unverified |
| Managed-database automated backups and point-in-time recovery | No managed database exists | The local restore drill proves the procedure, not the platform's backup feature |
| Multi-instance behaviour (rate limits, preview quota) | Single instance by design | Documented as a limitation in `docs/DEPLOYMENT.md` |
| Sustained concurrent load | No load-testing environment | Only single-request timings are reported |
| Real user data migration | No real data exists and no authorization was requested | Untested; the documented path is export → restore |

## Reproducing this report

```bash
npm ci
npm run db:generate
npm run db:deploy            # migrations on the development database
npm run db:test:deploy       # migrations on the isolated test database
npm test                     # 311 tests
npm run typecheck
npm run lint
npm run build
npm run test:e2e             # 7 browser tests
npm audit --omit=dev
```

The web service is a dependency-free Node server; run it with
`npm run start:web` (needs `API_INTERNAL_URL` when the API is on another host).

The production-shaped smoke test and the 50,000-row load test need a scratch
database; the exact commands are in the two sections above and in
`docs/DATA_BACKUP_AND_RESTORE.md`.
