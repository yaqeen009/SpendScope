# SpendScope production-readiness progress log

Work spans multiple sessions. Each phase records: changes, checks run, actual
outcomes, remaining work.

---

## Phase 0 — Baseline (2026-10-17)

**Changes:** none (inspection only). Added `PRODUCTION_READINESS.md` (untracked input)
and this log.

**Checks executed**

| Command | Result |
| --- | --- |
| `npm test` | 166 passed (shared 28, api 113, web 25) |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, 14 warnings |
| `npm run build` | success (api + web) |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `pg_ctl -D "$HOME/.spendscope/pgdata" status` | running, port 5433 |

**Outcome:** green baseline. Audit written to `docs/PRODUCTION_READINESS_AUDIT.md`.
Three critical findings: no auth (C-1), no ownership (C-2), import workspace
leakage (C-3). Deployment BLOCKED (no credentials/authorization).

**Next:** Phase 3 — authentication and workspace isolation.

---

## Phase 1 — Authentication and workspace isolation

**Changes**

- `apps/api/prisma/schema.prisma` — added `User` and `Session`; added
  `Workspace.ownerUserId` (nullable, `ON DELETE SET NULL`).
- `apps/api/prisma/migrations/20261017090000_auth/migration.sql` — new migration.
- `apps/api/prisma/migrations/20261017101500_settings_per_workspace/migration.sql`
  — **defect fix**: `Settings` used a singleton primary key (`id = 1`), so a
  second workspace could never have settings. `workspaceId` is now the primary
  key.
- `apps/api/src/lib/password.ts` — scrypt password hashing
  (`scrypt$N$r$p$salt$hash`), constant-time verification, timing-equalising
  `fakeVerify()` for unknown accounts.
- `apps/api/src/lib/tokens.ts` — 256-bit opaque session tokens; only the SHA-256
  hash is stored.
- `apps/api/src/lib/cookies.ts` — dependency-free cookie parse/serialise.
- `apps/api/src/modules/auth/*` — register, login, logout, `me`, profile,
  password change, session list/revoke, account deletion.
- `apps/api/src/middleware/auth.ts` — session cookie helpers, `attachSession`,
  `requireAuth`.
- `apps/api/src/middleware/csrf.ts` — origin check on state-changing requests.
- `apps/api/src/middleware/workspace.ts` — workspace id now comes from the
  session, never from the request.
- `apps/api/src/modules/imports/*` — **C-3 fixed**: preview/commit/report take
  the authenticated workspace instead of resolving the first workspace.
- `apps/api/src/config/env.ts` — session, rate-limit, registration and bootstrap
  settings plus a production configuration guard.
- `apps/api/src/modules/health/health.routes.ts` — liveness (`/health`) split
  from readiness (`/health/ready`).
- `apps/api/src/app.ts` / `server.ts` — auth wiring, trusted-proxy setting,
  rate limiters per app instance, session pruning at startup and hourly.
- Frontend: `features/auth/*` (provider, queries, sign-in, sign-up, account,
  route guard), `lib/api.ts` sends credentials and reacts to 401, app shell
  shows identity and sign-out.
- Tests: `tests/auth.test.ts` (16), `tests/isolation.test.ts` (12),
  `tests/helpers/api.ts`, `tests/helpers/db.ts` reworked; all existing specs now
  authenticate.
- E2E: `e2e/auth.spec.ts` (5), `import.spec.ts` signs in first.

**Checks executed**

| Command | Result |
| --- | --- |
| `npm test` | **166 passed** (shared 28, api 141, web 25) |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, 16 warnings |
| `npm run build` | success — largest chunk 493.08 kB (under the 500 kB warning) |
| `npm run test:e2e` | **7 passed** |

**Outcome**

- C-1, C-2, C-3 resolved: every data route requires a session and is scoped to
  the workspace that session owns; cross-workspace reads, writes, aggregates and
  import previews return 404 with no data leakage.
- Fixed the `Settings` singleton key defect found by the new auth tests.
- Rate limiting is per app instance, so it is not shared across instances.

**Remaining**

- Banking-grade MFA is not implemented (documented as out of scope).
- Password reset by email needs a mail provider that does not exist in this
  environment; documented in `docs/DEPLOYMENT.md`.

---

## Phase 2 — Financial integrity: refunds and transfers

**Changes**

- `Transaction.refundOfTransactionId` (self-relation, `ON DELETE SET NULL`) and
  `Transaction.transferGroupId`, plus indexes.
- `apps/api/src/lib/refunds.ts` — refund-link validation: same workspace, original
  must be an `EXPENSE`, category inheritance enforced, and the linked refunds can
  never exceed the original amount (partial and repeated refunds are supported).
- `apps/api/src/lib/transfers.ts` — manual pairing (`linkTransfer`), unlinking,
  and deterministic suggestions. Pairing requires two `TRANSFER` rows with equal
  amounts within five days.
- `POST /api/v1/transactions/:id/transfer`, `DELETE /api/v1/transactions/:id/transfer`,
  `GET /api/v1/transactions/transfer-suggestions`.
- `GET /api/v1/transactions/:id` reports `refundedAmount` for expenses.
- Changing an expense's category moves its linked refunds with it. Deleting one
  side of a paired transfer unpairs the survivor. Deleting an expense leaves its
  refunds in place as unlinked rows.

**Checks executed**

| Command | Result |
| --- | --- |
| `npx vitest run` (api) | **181 passed** (was 141) |
| `npm run typecheck` | clean |

**Outcome**

- Refunds are explicit, capped, and attributed to the original expense's
  category, so net spend is correct without extra aggregation SQL.
- Transfers remain excluded from income and expenses, before and after pairing;
  pairing is presentation and reconciliation only.
- Refund and transfer UI is **not implemented**. These endpoints are API-only by
  decision (no placeholder buttons). Documented in `docs/PRODUCTION_TEST_REPORT.md`.

---

## Phase 4D — Category rules

**Changes**

- `CategoryRule` model + `RuleMatchField` enum
  (`apps/api/prisma/migrations/20261017120000_category_rules/`).
- `apps/api/src/lib/category-rules.ts` — matching with a documented, fully
  deterministic order: `priority` ascending, then pattern length descending
  (specific beats broad), then id. Kind-safe: an expense rule can never
  categorise income, and transfers are never categorised.
- `apps/api/src/modules/category-rules/` — CRUD plus
  `POST /api/v1/category-rules/apply`.
- Import integration: rules are a **fallback**. The category named in the CSV
  wins, then the detected category, then the first matching rule. The preview
  shows the rule-applied category before anything is written.
- Retroactive apply defaults to **`dryRun: true`** and only ever fills a missing
  category; it never overwrites one. It reports per-rule and per-category counts.

**Checks executed**

| Command | Result |
| --- | --- |
| `npx vitest run` (api) | **181 passed**, including 16 new rule tests |
| `npm run typecheck` | clean |

**Outcome**

- Rules are workspace-scoped, explainable and idempotent.
- No UI: the rule editor is a deferred item (API-only, documented).

---

## Phase 5 — Export, backup/restore and durable import previews

**Changes**

- `GET /api/v1/exports/transactions.csv` — filtered CSV download using the same
  filters as the transaction list, capped at 50,000 rows (`X-Total-Truncated`
  reports whether the cap was hit). Cells that begin with `=`, `+`, `-`, `@`,
  TAB or CR are prefixed with a single quote, so a spreadsheet cannot execute
  them as a formula. Nothing in the file is ever evaluated by SpendScope.
- `GET /api/v1/exports/backup.json` — versioned document
  (`format: "spendscope-backup"`, `version: 1`) holding settings, categories,
  category rules, import batches, transactions and budgets. Categories travel by
  **name and kind**, not id, so a backup restores into a workspace whose ids
  differ.
- `POST /api/v1/exports/restore` — `mode: replace|merge` plus
  `confirm: "RESTORE"`. Runs in one transaction, only ever touches the
  authenticated workspace, preserves refund links, skips duplicate budgets and
  duplicate rules, and reports rows whose category was missing from the document.
- `ImportPreview` table replaces the in-process preview map. Previews now survive
  a restart and are shared by every instance, expire on a TTL, and commit
  **idempotently**: `status` moves PENDING → COMMITTING → COMMITTED inside the
  same transaction as the insert, and replaying a preview id returns the recorded
  result instead of importing the rows twice.

**Checks executed**

| Command | Result |
| --- | --- |
| `npx vitest run` (api) | **188 passed** (was 181) |
| `npm run typecheck` | clean |

**Outcome**

- The commit step is now safe to retry, which is what a flaky network needs.
- Restore is destructive only within the caller's own workspace, and only with
  an explicit confirmation string.
- No export/backup UI yet: the endpoints are API-only and documented.

---

## Phase 4B — Recurring-transaction detection

**Changes**

- `apps/api/src/lib/recurring.ts` — pure, deterministic detector. Groups rows by
  normalised name (merchant, else description), requires ≥3 occurrences of the
  **same amount**, and keeps a series only when every gap is within tolerance of
  the median gap (a quarter of the median or 4 days, whichever is larger) and the
  median maps onto a known cadence (weekly, fortnightly, monthly, quarterly,
  yearly).
- Each series carries a `seriesKey` (`name|amount`), `intervalDays`,
  `nextExpectedDate`, `confidence` and a plain-language `explanation`.
- `GET /api/v1/recurring` — read-only. Writes nothing, ever.
- `RecurringDismissal` model; `POST /api/v1/recurring/dismiss` and
  `DELETE /api/v1/recurring/dismiss/:seriesKey`. A dismissal only hides a series
  and is workspace-scoped.
- Dismissing an undetected key is rejected (404) so a typo cannot silently hide a
  real series later.

**Checks executed**

| Command | Result |
| --- | --- |
| `npx vitest run` (api) | **204 passed** (was 188), incl. 10 detector unit tests |
| `npm run typecheck` | clean |

**Outcome**

- Detection is explainable, cheap and reproducible; the only write in the module
  is remembering a dismissal.
- Known limitation, documented: a merchant whose reference number changes each
  period splits into separate series.

---

## Phase 6 — Currency model (conversion deliberately disabled)

**Changes**

- `Transaction.currency` (nullable). `NULL` means the workspace base currency
  (`Settings.currency`) and is what every pre-existing row is. A row may instead
  name an ISO-4217 code.
- **No conversion exists anywhere.** Every aggregate filters to
  `currency IS NULL`, so a total can never silently mix currencies.
  `fetchForeignCurrencyNotice` reports the excluded rows by currency, and the
  analytics summary carries it as `foreignCurrency`.
- The web dashboard shows a warning listing the excluded rows whenever any exist,
  so a total is never presented as complete when it is not.
- `POST /transactions` accepts `currency`; sending the base currency normalises to
  `NULL`. An unsupported code is rejected by validation.
- A refund must be in the original expense's currency, and an expense with linked
  refunds cannot change currency (both rejected with a clear message). The two
  sides of a transfer must share a currency, and cross-currency pairs are never
  suggested.
- `ExchangeRate` table added and documented as **reserved and unused**: a rate
  table exists so rates can be recorded and reviewed before conversion is ever
  enabled, and so the omission is explicit rather than accidental.
- CSV export gained a `currency` column holding the *resolved* code (so a
  base-currency row is labelled `GHS`, never blank). Backups carry `currency` and
  restore it, rejecting an unsupported code in the document.

**Checks executed**

| Command | Result |
| --- | --- |
| `npm test` | **268 passed** (shared 28 / api 215 / web 25) |
| `npm run typecheck` | clean |

**Outcome**

- Figures are honest: foreign-currency rows are visible, exportable, backed up and
  explicitly excluded, never silently summed.
- Depends on: nothing external. No FX provider, no rate fetching.

---

## Phase 8 / 10 — Security hardening, observability, performance

**Changes**

- `apps/api/src/config/env.ts` — `assertProductionConfiguration` refactored into a
  pure `productionConfigProblems(config)` plus the throwing wrapper, so the rules
  are unit testable. An explicitly acknowledged local run (local DB **and**
  insecure cookies **and** loopback origins) now relaxes the origin checks, which
  is what makes a production-shaped local stack possible without weakening the
  real checks.
- `apps/api/src/config/env.test.ts` — **new**, 11 unit tests covering every rule
  and its override.
- `apps/api/src/app.ts` — request ids: an inbound `x-request-id` is reused when it
  is a safe token, otherwise a UUID is generated; the id is echoed in the response.
- `apps/api/src/middleware/validate.ts` — every error body (including `404`, `413`
  and `500`) now carries `requestId`; 500s log the id alongside the stack. No
  message, stack or SQL detail is exposed.
- `apps/api/src/server.ts` — explicit `requestTimeout` (120s), `headersTimeout`
  (20s) and `keepAliveTimeout` (65s), and `closeIdleConnections()` on shutdown so
  a rolling deploy can actually drain.
- `apps/web/security-headers.inc` — **new**: `nosniff`, frameguard,
  `Referrer-Policy`, `Permissions-Policy` and a strict CSP
  (`connect-src 'self'`), included at the server level *and* inside every
  `location` that sets its own `add_header` (nginx discards inherited headers when
  a location defines one).
- `docs/SECURITY.md` — rewritten. The previous version documented "no
  authentication", "no CSRF protection" and "in-memory preview store" as facts;
  all three are now wrong, so the document was replaced rather than patched, and
  it now includes the personal-data inventory, the dependency audit and the
  updated accepted-risk table.

**Checks executed**

| Command | Result |
| --- | --- |
| `npx vitest run` (api) | 226 passed, then 230 after later phases |
| `npm run typecheck` | clean |
| `npm audit --omit=dev` | **0 vulnerabilities** |
| Guard against a real unsafe production config | the built server **refused to start**, naming all four problems |
| Load check: 50,000 transactions in one workspace | 24-month summary 53 ms, dashboard 36 ms, paged list 10 ms, 50,000-row CSV export 678 ms |
| Log inspection during the load run | no description, merchant, amount or cookie value in any log line |

**Outcome:** production configuration is fail-fast and tested; every response is
correlatable; performance is measured rather than asserted. Error monitoring is
deliberately not configured (it would receive financial context).

---

## Phase 11 / 12 — CI, containers, deployment and backup documentation

**Changes**

- `.github/workflows/ci.yml` — **new**. Lint, typecheck, the full suite against a
  real PostgreSQL 16 service, test-database creation, migrations on both
  databases, production build, and a second job that installs Chromium and runs
  the Playwright suite. No production secret is referenced.
- `apps/api/Dockerfile` — multi-stage with three targets: `build` (full install,
  Prisma generate, tsup bundle), `migrate` (one-shot `prisma migrate deploy`), and
  the non-root `runtime` image with a liveness `HEALTHCHECK`.
- `apps/web/Dockerfile` — Vite build stage plus nginx serving the SPA and
  proxying `/api`, the same-origin shape the client expects.
- `apps/web/nginx.conf` — SPA fallback, immutable asset caching with `no-store`
  `index.html`, `/api` proxy with forwarded headers and a 12 MB body limit.
- `docker-compose.yml` — production-shaped local stack: PostgreSQL with a volume,
  a `migrate` job the API waits for, and `NODE_ENV=production` with only the two
  documented local overrides. **Not a production deployment.**
- `.dockerignore` — excludes `node_modules`, build output, `.env` and the local
  cluster.
- `docs/DEPLOYMENT.md`, `docs/DATA_BACKUP_AND_RESTORE.md` — **new**.
- `docs/PRODUCTION_TEST_REPORT.md` — **new**: executed checks, the smoke test
  table, the load timings, and an explicit list of what was **not** tested.
- `README.md`, `.env.example` — updated for auth, the new features, the CI and
  deployment files, and production connection-pool guidance.

**Checks executed**

| Command | Result |
| --- | --- |
| Restore drill: `pg_dump -Fc` → scratch DB → `pg_restore` → compare → boot the API | identical table list (13), identical row counts, `health/ready` → `database: "up"` |
| `docker --version` | **not installed** — images are written but unbuilt (recorded as unverified) |
| `npx prisma migrate deploy` against an **empty** database | 9 migrations, 13 tables, `migrate status` → up to date |
| GitHub Actions | **no runner available** — configure-only, never executed |

**Outcome:** delivery artefacts and procedures are complete and documented; the
image build and CI execution are explicitly unverified rather than implied.

---

## Phase 13 — Production-shaped smoke test (local)

**Changes**

- `apps/api/src/modules/auth/*`, `packages/shared/src/schemas/auth.ts`,
  `apps/web/src/features/auth/account-page.tsx` — account deletion now requires
  the **account password** as well as the `DELETE` token, and the account page
  has the matching field. Deleting an account is the one irreversible operation in
  the product; a stolen session cookie alone must not be able to destroy a user's
  history.

**Checks executed** — the production build, `NODE_ENV=production`, the
configuration guard active, against a **restored copy** of the database. 16
behaviours verified; full table in `docs/PRODUCTION_TEST_REPORT.md`. Highlights:

| Check | Result |
| --- | --- |
| Unsafe production config | refused to start, all problems named |
| Liveness / readiness | `200` / `200 database: "up"` |
| Request id | present on every response; a safe inbound id is echoed |
| Registration on a clean database with `BOOTSTRAP_DEFAULT_WORKSPACE=false` | the account got its own workspace; nothing was bootstrapped |
| CSRF | foreign `Origin` → `403`, no row written |
| Financial integrity | base expense and income counted; the USD row excluded **and reported** in `foreignCurrency` |
| CSV export | `currency` column resolved (`GHS` / `USD`), `nosniff`, attachment disposition |
| Anonymous access | `401` with a request id |
| Sign out | `204`, then the same cookie → `401` |
| Logs | no financial payload or credential (warnings only: code, path, status) |

**Outcome:** the real production code path works end-to-end locally against real
data. No public deployment exists, so this is **not** a deployed smoke test.

---

## Phase 14 — Final audit and verification

**Changes**

- `docs/PRODUCTION_READINESS_AUDIT.md` — final requirement-by-requirement audit
  appended: every finding from section 4 re-checked, plus feature, authentication,
  security, database, performance, testing, deployment and deferral tables, each
  with a status, evidence, the command run and the actual result.

**Checks executed**

| Command | Result |
| --- | --- |
| `npm test` | **283 passed** (shared 28, api 230, web 25) |
| `npm run test:e2e` | **7 passed** |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, 19 warnings |
| `npm run build` | success (API 270 kB bundle, web index 493 kB / 148 kB gzipped) |
| `npm audit --omit=dev` | 0 vulnerabilities |

**Outcome:** all requirements that can be verified in this environment are
**PASS** with executed evidence. Outstanding **BLOCKED** items are environmental
only: no deployment provider, database, domain or credential (public deployment
and the public smoke test), no GitHub runner (CI execution), no Docker on this
machine (image build), and no managed-database platform (automated backups).
Deferred, non-critical items are listed in the audit with their impact.

**Next:** none locally. To finish, follow `docs/DEPLOYMENT.md` §"Remaining manual
steps" — choose a provider, supply `DATABASE_URL` and `CORS_ORIGIN` from a secret
store, point a domain at it, run `migrate deploy`, then run the production smoke
test with a test account and record it in `docs/PRODUCTION_TEST_REPORT.md`.

---

<!-- phases appended below as they complete -->
