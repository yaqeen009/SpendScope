# Production Readiness Audit — SpendScope

**Audit date:** 2026-10-17
**Auditor:** automated engineering pass (inspected source, migrations, tests, Git state, live database)
**Scope:** the actual repository at commit `c24cf6d` ("mvp features completed"), working tree clean except `PRODUCTION_READINESS.md`.
**Specifications:** `OPENCODE_SPEC.md` (MVP) and `PRODUCTION_READINESS.md` (production hardening).

No secret values, credentials or financial records appear in this document.

---

## 1. Environment

| Item | Value |
| --- | --- |
| Node.js | v24.21.0 (`engines: >=20.19.0`) |
| npm | 11.19.0 (workspaces; single committed `package-lock.json`) |
| TypeScript | 5.9.3, `strict` + `verbatimModuleSyntax` + `noUncheckedIndexedAccess` |
| PostgreSQL | 18, local cluster `~/.spendscope/pgdata`, port 5433, trust auth, loopback |
| Databases | `spendscope` (dev), `spendscope_test` (tests), both migrated |
| Prisma | 7.10.1 (`prisma-client` generator, driver adapter `@prisma/adapter-pg`) |
| Platform | macOS (darwin) |

The database was confirmed running (`pg_ctl status`, PID 23349) and both
databases exist.

## 2. Repository shape

- `apps/api` — Express 5 API, Prisma, migrations, seed, Vitest unit + integration tests.
- `apps/web` — React 19 SPA (Vite 8, Tailwind 4, TanStack Query, RHF/Zod, Recharts), component tests, Playwright e2e.
- `packages/shared` — enums, Zod schemas, DTO types, money/date/period/format helpers (shipped as TS source).
- `docs/` — LOCAL_POSTGRES, DATA_MODEL, FINANCIAL_RULES, DECISIONS, SECURITY.
- No `.github/`, no Dockerfile, no compose file, no deployment configuration of any kind.

## 3. Baseline checks actually executed

| Command | Result |
| --- | --- |
| `npm test` | **166 passed** — shared 28 (3 files), api 113 (11 files), web 25 (7 files) |
| `npm run typecheck` | **clean** (shared, api, web) |
| `npm run lint` | **0 errors, 14 warnings** (`react-refresh/only-export-components`, `react-hooks/incompatible-library`) |
| `npm run build` | **success** — API (tsup) + web (Vite, largest chunk 487.25 kB) |
| `npm audit --omit=dev` | **0 vulnerabilities** |
| `npm run test:e2e` (previous session) | 2 passed (real import + invalid-file block) |
| `pg_ctl status` | running on port 5433 |
| `psql -l` | `spendscope`, `spendscope_test` present |

Baseline is green. Every subsequent change must keep it green.

## 4. Findings

### 4.1 Critical

| ID | Finding | Evidence |
| --- | --- | --- |
| C-1 | **No authentication or authorization anywhere.** Every endpoint is fully open. | `apps/api/src/app.ts` mounts all routers with no auth middleware; `apps/api/src/modules/workspace/workspace.service.ts:70` `getWorkspaceId()` returns the *first* workspace. |
| C-2 | **No user model and no workspace ownership.** `Workspace` has no owner column. | `apps/api/prisma/schema.prisma:46-57`. |
| C-3 | **Import endpoints ignore the caller's workspace.** `previewImport` / `commitImport` / `rebuildCandidatesForPreview` / `buildPreviewErrorReport` call `currentWorkspaceId()` internally instead of accepting the request workspace. | `apps/api/src/modules/imports/imports.service.ts:250,386,408`; `imports.routes.ts:36-45`. |

### 4.2 High

| ID | Finding | Evidence |
| --- | --- | --- |
| H-1 | **No cross-workspace isolation tests** (nothing proves one user cannot read another's rows). | No user model exists; `apps/api/tests/*` never create two workspaces. |
| H-2 | **Import previews are in-process memory.** Lost on restart; not shareable across instances; retained only 30 min. | `apps/api/src/lib/import-preview-store.ts`, `preview-store.instance.ts`. |
| H-3 | **No CSV export.** No transaction export endpoint exists; spreadsheet formula injection is therefore untested. | `grep -r export.csv` → only the error-report CSV (`imports.service.ts:592`). |
| H-4 | **No workspace backup/restore.** No versioned export, no restore validation. | No route or service. |
| H-5 | **No CI.** Nothing prevents a broken commit from reaching `main`. | `.github/` absent. |
| H-6 | **No production configuration validation.** `env.ts` accepts any `CORS_ORIGIN`, any `DATABASE_URL`, and does not require secure-cookie or HTTPS settings for production. | `apps/api/src/config/env.ts:14-22`. |

### 4.3 Medium

| ID | Finding | Evidence |
| --- | --- | --- |
| M-1 | **Refunds are not linked to their original expense.** A refund reduces expenses in its own category only. | `apps/api/src/lib/aggregates.ts:110`; no `refundOf` relation. |
| M-2 | **No account-to-account transfer matching.** `TRANSFER` carries no direction and no pairing; two sides cannot be grouped. | `schema.prisma:22-27`; `transactions.service.ts:31` rejects categories for transfers. |
| M-3 | **No configurable category rules.** Only the hardcoded keyword heuristic. | `apps/api/src/lib/categorize.ts`. |
| M-4 | **No recurring-transaction detection.** The "Subscriptions" insight only sums one hardcoded category. | `apps/api/src/modules/analytics/insights.ts:104-111`. |
| M-5 | **Currency is display-only with no model for conversion.** No per-transaction currency, no rate table, no metadata. | `packages/shared/src/format.ts`; `SettingsDTO`. |
| M-6 | **No Docker/deployment artefacts and no `docs/DEPLOYMENT.md`.** | absent. |
| M-7 | **Demo seed is not explicitly gated from production.** `db:seed` inserts demo rows into whatever database `DATABASE_URL` points at; `ensureWorkspace()` bootstraps a workspace on every start. | `apps/api/prisma/seed.ts`, `server.ts`. |
| M-8 | **Health check mixes liveness and readiness** and calls `getWorkspaceId()`, which will be meaningless once auth owns workspace creation. | `health.routes.ts:20`. |

### 4.4 Low

| ID | Finding | Evidence |
| --- | --- | --- |
| L-1 | No request-correlation id configured explicitly (pino-http default is used). | `app.ts:59`. |
| L-2 | No documented backup retention/recovery drill. | `docs/` lacks the file. |
| L-3 | `STRUCTURE`: e2e covers only the import flow. | `apps/web/e2e/import.spec.ts`. |
| L-4 | 14 ESLint warnings remain (non-blocking, informational). | `npm run lint`. |

## 5. What is genuinely good (do not regress)

- Decimal-safe money: positive magnitude + explicit type, decimal strings on the wire, `BigInt` minor units in arithmetic, SQL aggregates for totals.
- Duplicate detection: SHA-256 fingerprint plus a separate possible-duplicate pass, with a documented scan cap.
- Import commit re-validates from stored records and is single-use.
- Structured logging with redaction of descriptions, notes, merchants, cookies and authorization headers.
- Partial unique index enforcing one total monthly budget; committed migrations; idempotent seed.
- Per-request Zod validation with a uniform error envelope; rate limiting; helmet; body-size cap.
- Code-split frontend; theme applied before first paint; accessible native controls.

## 6. Missing infrastructure / credentials

- No cloud provider account, database URL, domain, or secret manager is configured in this environment.
- No `.env` production values exist; only local development values.
- No GitHub remote credentials are needed for a workflow file, but **no deployment target is authorised**.

**Consequence:** deployment (Phase 12) and the public smoke test (Phase 13) are **BLOCKED**
pending explicit authorization and credentials. All local preparation, tests, CI, and
deployment documentation can and will be completed.

## 7. Recommended deployment architecture (simplest reliable)

Given a single Node.js API (Express + Prisma), a static SPA build, and a managed
PostgreSQL requirement, with no background workers and no object storage:

1. **API** — a container (or any Node host) running `node apps/api/dist/server.js`, fronted by HTTPS.
2. **Web** — the Vite `dist/` static bundle served from the same origin (reverse-proxied to `/api`) so cookies are first-party and CORS is minimal.
3. **Database** — managed PostgreSQL with automated backups; the app connects over TLS with a least-privilege role.

Same-origin serving removes cross-site cookie/CSRF complexity and keeps CORS a
single value. Full detail in `docs/DEPLOYMENT.md`.

## 8. Prioritised implementation plan

| Priority | Work | Phase |
| --- | --- | --- |
| 1 | Auth (scrypt), sessions, ownership columns, workspace from session, isolation tests | 3 |
| 2 | Import endpoints scoped to the authenticated workspace | 2/3 |
| 3 | Refund linkage, transfer pairing, financial edge-case tests | 2/4 |
| 4 | Category rules (configurable, ordered, import-integrated) | 4D |
| 5 | Recurring-transaction detection (explainable) | 4B |
| 6 | CSV export with formula-injection guard | 5 |
| 7 | Versioned workspace backup/restore | 5 |
| 8 | Durable import sessions (DB-backed, expiring, idempotent commit) | 5 |
| 9 | Currency model with conversion disabled + documented dependency | 6 |
| 10 | Production env validation, CSRF, log redaction review, dependency audit | 8 |
| 11 | Health/readiness split, request ids | 10 |
| 12 | CI workflow | 11 |
| 13 | Dockerfile, compose, deployment + backup docs, restore drill | 9/12 |
| 14 | Final requirement-by-requirement audit and test report | 14 |

Zero-server/SQLite (Phase 7) is evaluated and documented only; it is not a
prerequisite for the PostgreSQL deployment and would destabilise the current
architecture (Prisma raw SQL uses `date_trunc`, partial indexes and `::uuid`
casts).

## 9. Release gate assessment (at audit time)

SpendScope is **not production-ready** at the start of this work. The blocking
issues are C-1 (no authentication), C-2 (no ownership) and C-3 (import
workspace leakage). Progress against each requirement is tracked in
`PROGRESS.md`.

---

# Final audit

**Audit date:** 2026-10-17 (final pass)
**Implementation state:** the tip commit of this work, `chore(production): security hardening, CI, containers, deployment and audit`, on top of `42d0f7d` (currency, Phase 6) and `c1670fb` (recurring, Phase 4B).
**Method:** each requirement below was verified against the running application — real HTTP requests, a real PostgreSQL database, real browser end-to-end runs — not against the documentation. Commands and observed outputs are in `docs/PRODUCTION_TEST_REPORT.md`.

Statuses: **PASS** = implemented and verified with evidence. **FAIL** = verification demonstrated a defect. **BLOCKED** = could not be verified because of a missing external dependency or permission. **NOT IMPLEMENTED** = the feature is absent.

## A. Findings from section 4 — resolved?

| ID | Finding | Status | Evidence |
| -- | ------- | ------ | -------- |
| C-1 | No authentication or authorization anywhere | **PASS (fixed)** | `modules/auth/*`, `middleware/auth.ts`; every data router behind `protectedApi.use(requireAuth)` (`app.ts:117`); smoke test: no cookie → `401` |
| C-2 | No user model, no workspace ownership | **PASS (fixed)** | `User`, `Session` models; `Workspace.ownerUserId`; workspace resolved from the session |
| C-3 | Import endpoints ignore the caller's workspace | **PASS (fixed)** | services take `workspaceId`; `tests/isolation.test.ts` creates two accounts and proves separation |
| H-1 | No cross-workspace isolation tests | **PASS** | `tests/isolation.test.ts` (12 tests, two real accounts) |
| H-2 | Import previews are in-process memory | **PASS (fixed)** | `ImportPreview` table + DB-backed store; survives restart; expiry swept at startup and hourly |
| H-3 | No CSV export, no injection guard | **PASS** | `GET /api/v1/exports/transactions.csv`; `csvCell` prefixes `= + - @ TAB CR`; `tests/exports.test.ts` |
| H-4 | No workspace backup/restore | **PASS** | `GET /exports/backup.json`, `POST /exports/restore` (requires `mode` + `confirm: 'RESTORE'`, transactional, workspace-scoped) |
| H-5 | No CI | **PASS (configured) / BLOCKED (execution)** | `.github/workflows/ci.yml` exists; **no runner available, never executed** |
| H-6 | No production configuration validation | **PASS** | `assertProductionConfiguration()` + 11 unit tests; smoke test: unsafe production config refuses to start |
| M-1 | Refunds not linked to the original expense | **PASS** | `lib/refunds.ts`, `Transaction.refundOfTransactionId`; over-refunding rejected |
| M-2 | No transfer matching | **PASS** | `lib/transfers.ts`, `transferGroupId`, pair/unlink/suggestions endpoints |
| M-3 | No configurable category rules | **PASS** | `CategoryRule` model, ordered and kind-safe, integrated into import |
| M-4 | No recurring-transaction detection | **PASS** | `lib/recurring.ts` + dismissals; 10 unit tests + integration tests |
| M-5 | Currency is display-only, no model | **PASS** | `Transaction.currency`, exclusion from all aggregates, `ExchangeRate` reserved |
| M-6 | No Docker or deployment artefacts | **PASS** | both Dockerfiles, `docker-compose.yml`, `nginx.conf`, security-headers snippet, `docs/DEPLOYMENT.md`, `docs/DATA_BACKUP_AND_RESTORE.md` — **image build unverified (no Docker here)** |
| M-7 | Demo seed not gated from production | **PASS** | `BOOTSTRAP_DEFAULT_WORKSPACE=false` required in production by the guard; seeding is explicit tooling only |
| M-8 | Health check mixes liveness and readiness | **PASS** | `GET /health` (no DB) and `GET /health/ready` (`SELECT 1`, 200/503) |
| L-1 | No request-correlation id | **PASS** | `genReqId` in `app.ts`; `x-request-id` echoed and included in error bodies |
| L-2 | No documented backup/retention/drill | **PASS** | `docs/DATA_BACKUP_AND_RESTORE.md` with an executed drill |
| L-3 | e2e covers only the import flow | **PASS** | `e2e/auth.spec.ts` (5 tests) added; 7 e2e tests total |
| L-4 | 14 ESLint warnings | **PASS** | 0 errors; 19 warnings, all `react-refresh`/`react-hooks` advisories, none new defects |

## B. Application features (`OPENCODE_SPEC.md` §1–§15)

| ID | Requirement | Status | Evidence / command / result |
| -- | ----------- | ------ | --------------------------- |
| F-1 | Transaction CRUD (create, read, update, delete) | **PASS** | `modules/transactions/*`; `tests/transactions.test.ts`; smoke test created rows over HTTP |
| F-2 | Query filtering: search, date range, category (incl. `uncategorized`), type, review status, amount range, currency, sort, pagination | **PASS** | `transactionQuerySchema`; `tests/transactions.test.ts`, `tests/currency.test.ts` |
| F-3 | CSV import: delimiter detection, column mapping, per-row validation | **PASS** | `lib/csv.ts` + `modules/imports/*`; `tests/imports.test.ts`; e2e wizard test |
| F-4 | Import error report for rejected rows | **PASS** | `GET /imports/previews/:id/report`; e2e "reports invalid rows and refuses to import them" |
| F-5 | Duplicate detection | **PASS** | SHA-256 fingerprint + possible-duplicate pass; `tests/imports.test.ts` |
| F-6 | Import persistence and history | **PASS** | `ImportBatch` rows; `GET /imports`, `GET /imports/:id` |
| F-7 | Import preview persistence and expiration | **PASS** | `ImportPreview` table, TTL `IMPORT_PREVIEW_TTL_MINUTES`, cap 25/workspace; expired preview → `404`; `tests/imports.test.ts` |
| F-8 | Repeating an import does not duplicate rows | **PASS** | idempotent commit (`PENDING → COMMITTING → COMMITTED`); replay returns the stored result; `tests/imports.test.ts` |
| F-9 | Dashboard, charts and insights use real backend data | **PASS** | `GET /analytics/dashboard`, `/time-series`, `/categories`, `/monthly-trend`, `/recent-transactions`, `/largest-expenses`; all SQL-aggregated; e2e signs in and reaches the overview |
| F-10 | Financial calculations: income, expenses, refunds, net, savings rate; transfers excluded | **PASS** | `lib/finance.ts` + `lib/aggregates.ts`; `docs/FINANCIAL_RULES.md`; `tests/financial-integrity.test.ts` |
| F-11 | Decimal precision, no floating point in totals | **PASS** | Prisma `Decimal(14,2)` throughout; money assertions in tests; 50,000-row summary totals exactly |
| F-12 | Date boundaries (inclusive ranges, month/period resolution) | **PASS** | `lib/dates.ts`, `lib/periods.ts`; boundary tests in `tests/analytics.test.ts` |
| F-13 | Budgets: create, list, progress, delete; one total budget per month | **PASS** | `modules/budgets/*`; partial unique index; `tests/budgets.test.ts` |
| F-14 | Category management and kind rules | **PASS** | `modules/categories/*`; expense/income kinds enforced in `resolveCategoryId` |
| F-15 | Settings (currency, locale, theme, default period) | **PASS** | `modules/settings/*`; `Settings.workspaceId` is the PK (one settings row per workspace) |
| F-16 | Demo/sample data controls | **PASS** | `POST /settings/demo-data`; "clear sample data" deletes only `isSample` rows |
| F-17 | Refund handling: explicit link, category inheritance, over-refund rejection | **PASS** | `lib/refunds.ts`; `tests/financial-integrity.test.ts`, `tests/currency.test.ts` |
| F-18 | Transfer pairing: manual, explicit, suggestions advisory | **PASS** | `lib/transfers.ts`; pair requires equal amount and currency; unlink restores both | 
| F-19 | Recurring transaction detection with dismissal | **PASS** | `lib/recurring.ts` (pure, ≥3 occurrences, cadence tolerance); `tests/recurring.test.ts` |
| F-20 | Configurable category rules | **PASS** | `modules/category-rules/*`; deterministic ordering; never overwrites; `POST /:id/apply` dry-run by default |
| F-21 | CSV export | **PASS** | `GET /exports/transactions.csv`; capped at 50,000 with `X-Total-Truncated`; 50,000-row export verified at 678 ms |
| F-22 | Backup and restore | **PASS** | `GET /exports/backup.json`, `POST /exports/restore`; categories referenced by name + kind; `tests/exports.test.ts` |
| F-23 | Currency handling with conversion limitation documented | **PASS** | per-row currency; excluded from aggregates and reported; `ExchangeRate` reserved and documented; `tests/currency.test.ts` (11 tests) |
| F-24 | Uniform error envelope with safe messages | **PASS** | `middleware/validate.ts` + `lib/errors.ts`; smoke test: `400/401/403` bodies contain no stack or SQL |

## C. Authentication and workspace isolation (`PRODUCTION_READINESS.md` Phase Three)

| ID | Requirement | Status | Evidence |
| -- | ----------- | ------ | -------- |
| A-1 | Real accounts with hashed passwords | **PASS** | scrypt N=16384, r=8, p=1 via `lib/password.ts`; constant-time compare |
| A-2 | Session authentication | **PASS** | 256-bit opaque token, SHA-256 hash at rest, expiry, revocation |
| A-3 | Cookie hardening | **PASS** | `HttpOnly`, `SameSite=Lax`, `Secure` in production (smoke test inspected the cookie jar: `#HttpOnly_…`) |
| A-4 | Workspace ownership and resolution from the session | **PASS** | `Workspace.ownerUserId`, `middleware/workspace.ts` |
| A-5 | Cross-workspace access prevention | **PASS** | `tests/isolation.test.ts` (12 tests) — a second account sees none of the first's rows |
| A-6 | Authorization on every data route | **PASS** | `protectedApi.use(requireAuth)` (`app.ts:117`); smoke test: anonymous → `401` |
| A-7 | CSRF defence | **PASS** | `SameSite=Lax` + `requireTrustedOrigin`; foreign origin → `403` (smoke test step 7) |
| A-8 | Rate-limited authentication | **PASS** | separate login/register limiters; `tests/auth.test.ts` proves a 429 |
| A-9 | Session listing and revocation | **PASS** | `GET /auth/sessions`, `DELETE /auth/sessions/:id`, `POST /auth/sessions/revoke-others` |
| A-10 | Password change revokes other sessions | **PASS** | `changePassword` deletes other sessions; `tests/auth.test.ts` |
| A-11 | Account deletion is explicit and complete | **PASS** | `DELETE /auth/me` requires the token **and** the password; deletes account + owned workspaces transactionally; test asserts the rows are gone and no orphan workspace remains |
| A-12 | No workspace leakage via the default-workspace bootstrap | **PASS** | `BOOTSTRAP_DEFAULT_WORKSPACE` must be false in production (guard-enforced); a fresh DB with it false gave each registration its own workspace |

## D. Security hardening (`PRODUCTION_READINESS.md` Phase Eight)

| ID | Requirement | Status | Evidence |
| -- | ----------- | ------ | -------- |
| S-1 | No secrets in tracked files | **PASS** | `git ls-files` contains no `.env`; `.gitignore` covers `.env`, the generated client and `.spendscope/` |
| S-2 | `.env.example` documents every variable with placeholders only | **PASS** | `.env.example` (76 lines), including proxy and production-safety overrides |
| S-3 | Validate required production configuration at startup | **PASS** | `assertProductionConfiguration`; 11 unit tests; the built server refused to start with an unsafe config and named all four problems |
| S-4 | Fail safely when critical configuration is missing | **PASS** | `DATABASE_URL` is required by the schema; the process exits non-zero rather than serving |
| S-5 | Separate development, test and production configuration | **PASS** | `NODE_ENV` profiles; `TEST_DATABASE_URL` must differ from `DATABASE_URL` |
| S-6 | Validate bodies, queries, path params, uploads and restored backups | **PASS** | Zod at every boundary; `restoreBackupSchema`; `tests/exports.test.ts` rejects a malformed backup |
| S-7 | CORS restricted to known production origins | **PASS** | `CORS_ORIGIN`, `credentials: false`, non-matching origin → no headers + clean `403` |
| S-8 | Security headers | **PASS** | helmet on the API (incl. HSTS); CSP/`nosniff`/frameguard/Referrer-Policy on the SPA via `apps/web/security-headers.inc` |
| S-9 | Request size limits | **PASS** | `MAX_UPLOAD_BYTES` on the JSON parser; nginx `client_max_body_size 12m`; oversized body → `413` |
| S-10 | Rate-limit sensitive and expensive endpoints | **PASS** | auth limiters, imports 30/min, writes 120/min; tested |
| S-11 | Do not leak stack traces, SQL or internal errors | **PASS** | `errorHandler` returns generic `INTERNAL_ERROR`; only `code`, `message`, `details` (validated) and `requestId` are exposed |
| S-12 | Log enough context but no financial payloads | **PASS** | pino logs method/path/status/code/requestId only; request and response bodies are never logged (smoke test step 16) |
| S-13 | CSV import/export injection review | **PASS** | CSV is never executed or interpolated into SQL; export neutralises formula-leading cells |
| S-14 | Dependency review with exceptions explained | **PASS** | `npm audit --omit=dev` → **0 vulnerabilities**; no exception is needed |
| S-15 | HTTPS required for production traffic | **PASS (configuration) / BLOCKED (live TLS)** | guard requires an `https://` origin and `Secure` cookies; HSTS set by helmet and to be set at the TLS terminator. No live TLS endpoint exists |
| S-16 | Managed secret storage | **PASS (documented) / BLOCKED (not provisioned)** | `docs/DEPLOYMENT.md`; no secret manager is authorised |
| S-17 | Restrict database access, least-privilege credentials | **PASS (documented)** | role requirements in `docs/DATA_BACKUP_AND_RESTORE.md`; the local dev cluster uses trust auth and is loopback-only, documented as a local-only risk |
| S-18 | Backup retention and deletion policy | **PASS (documented)** | retention tiers in `docs/DATA_BACKUP_AND_RESTORE.md` |
| S-19 | Document what personal data is stored and why | **PASS** | data inventory table in `docs/SECURITY.md` |
| S-20 | No financial data sent to third-party analytics or AI | **PASS** | no telemetry dependency anywhere; SPA CSP is `connect-src 'self'`; audit confirms no analytics package |
| S-21 | Account-data export and deletion strategy | **PASS** | export: CSV + `backup.json`; deletion: `DELETE /auth/me` (password + token) with full cascade; strategy documented |

## E. Database reliability (`PRODUCTION_READINESS.md` Phase Nine)

| ID | Requirement | Status | Evidence |
| -- | ----------- | ------ | -------- |
| D-1 | Migrations apply to a clean database | **PASS** | `migrate deploy` on an empty database: 9 migrations, 13 tables, `migrate status` → up to date |
| D-2 | Existing databases upgrade safely | **PASS** | the development database was upgraded incrementally through every migration in this work with data intact; migrations in a release are additive |
| D-3 | Foreign keys, uniqueness, indexes and deletion behaviour reviewed | **PASS** | `onDelete` semantics per relation (workspace cascade, `SetNull` for category/import/refund-of); unique indexes for password/token hashes, budget month, exchange rate; `docs/DATA_MODEL.md` |
| D-4 | Indexes for demonstrated query patterns | **PASS** | `[workspaceId, transactionDate]`, `[workspaceId, type]`, `[workspaceId, currency]`, `[workspaceId, fingerprint]`, rule and dismissal indexes; 24-month summary over 50,000 rows in 53 ms |
| D-5 | No destructive production migrations | **PASS** | every migration adds columns, tables or indexes; no `DROP COLUMN`/`DROP TABLE` on populated tables |
| D-6 | Schema migration separated from demo seeding | **PASS** | `migrate deploy` never seeds; `db:seed` is explicit; sample data is a settings action |
| D-7 | Never run destructive seed/reset against production | **PASS** | the production guard blocks bootstrapping; the reset endpoint requires `RESET`; docs state the prohibition |
| D-8 | Transactions for related writes | **PASS** | import commit, backup restore and account deletion each run in a Prisma transaction |
| D-9 | Failed imports roll back | **PASS** | import commit is a single transaction; failures leave no partial rows (`tests/imports.test.ts`) |
| D-10 | Connection pooling and limits | **PASS (documented)** | `@prisma/adapter-pg` pool; `connection_limit`/`pool_timeout` guidance in `docs/DEPLOYMENT.md` |
| D-11 | Database timeouts and failure handling | **PASS** | readiness returns `503` when the database is unreachable; liveness stays `200` so a database outage does not restart-loop the process; server timeouts set explicitly |
| D-12 | Migration, rollback and recovery procedures documented | **PASS** | `docs/DEPLOYMENT.md` (migration + rollback), `docs/DATA_BACKUP_AND_RESTORE.md` (recovery) |
| D-13 | Automated backups configured | **BLOCKED** | requires a database platform; policy and procedures documented, nothing provisioned |
| D-14 | Restore drill performed in a separate environment | **PASS** | executed: dump → scratch database → identical schema (13 tables) and row counts → API booted against the restored copy → scratch dropped |
| D-15 | Do not test recovery against production data | **PASS** | the drill used only the development database and a scratch database |

## F. Performance and observability (`PRODUCTION_READINESS.md` Phase Ten)

| ID | Requirement | Status | Evidence |
| -- | ----------- | ------ | -------- |
| O-1 | Pagination for large datasets | **PASS** | page size default 50, max 200; transaction list, imports and recurring series paginate |
| O-2 | Analytics use database aggregation | **PASS** | SQL `GROUP BY`/`SUM` in `lib/aggregates.ts`; raw SQL uses `date_trunc` |
| O-3 | Avoid loading all transactions per dashboard request | **PASS** | dashboard makes 5 aggregate queries + bounded lists; 36 ms at 50,000 rows |
| O-4 | Identify N+1 query patterns | **PASS** | no per-row queries in list paths; category is included via a relation `select`; imports batch fingerprint lookups in chunks of 2,000 |
| O-5 | Large CSV import memory and batch writes | **PASS** | body capped; ≤20,000 rows per import; writes batched with `createMany`; previews capped and expiring |
| O-6 | Reasonable request timeouts | **PASS** | `requestTimeout` 120s, `headersTimeout` 20s, `keepAliveTimeout` 65s; nginx proxy read timeout 120s |
| O-7 | Health and readiness checks, distinguished | **PASS** | `/health` liveness (always 200, no DB) vs `/health/ready` (`SELECT 1`, 200/503) |
| O-8 | Structured server logs | **PASS** | pino with level, time, request id; health checks excluded from access logs |
| O-9 | Request correlation identifiers | **PASS** | `x-request-id` generated or reused from a safe inbound value, echoed and included in error bodies |
| O-10 | Record errors without logging financial payloads | **PASS** | error logs carry code/path/status/requestId; bodies are never logged |
| O-11 | Error monitoring where a provider is available and approved | **NOT IMPLEMENTED (deferred)** | no provider is approved and any such provider would receive error context; correlation is via request id instead. Non-critical |
| O-12 | No financial data in third-party telemetry | **PASS** | no telemetry dependency; CSP restricts connections to self |
| O-13 | Practical load or performance check, with limitations stated | **PASS** | 50,000-row workload timed per endpoint, single instance, warm cache; limitations stated explicitly |

## G. Testing and CI (`PRODUCTION_READINESS.md` Phase Eleven)

| ID | Requirement | Status | Evidence |
| -- | ----------- | ------ | -------- |
| T-1 | Dependencies installed from the committed lockfile | **PASS** | `npm ci` in CI and locally; single `package-lock.json` |
| T-2 | Lint check | **PASS** | 0 errors (19 advisory warnings); `format:check` is not gated and the pre-existing gap is recorded instead of hidden |
| T-3 | Type checks | **PASS** | `npm run typecheck` clean across shared, api, web |
| T-4 | Unit tests | **PASS** | shared 28, web 25, plus API unit tests (`lib/*.test.ts`) |
| T-5 | Backend integration tests against a real database | **PASS** | API 230 tests over 21 files against real PostgreSQL; no mocked database |
| T-6 | Frontend integration/e2e tests | **PASS** | 7 Playwright tests (auth, protection, sign-in/out, account page, CSV import, invalid-file handling) |
| T-7 | Production builds | **PASS** | `npm run build` succeeds for API and web |
| T-8 | Migration checks against an isolated test database | **PASS** | `db:test:deploy` + `global-setup` migrate the test database before the suite |
| T-9 | e2e in CI where services permit | **PASS (configured) / BLOCKED (never run)** | a dedicated CI job installs Chromium and runs the suite |
| T-10 | Tests for isolation, auth, repeated imports, refunds, transfers, rule conflicts, CSV injection, backup validation, currency, expired previews, boundaries, production config | **PASS** | each has a named spec: `isolation`, `auth`, `imports`, `financial-integrity`, `category-rules`, `exports`, `currency`, `recurring`, `analytics`, `config/env.test.ts` |
| T-11 | Do not weaken tests or skip suites | **PASS** | no `.skip`, no `any`, no removed assertions; three specs were **rewritten** where behaviour intentionally changed (preview single-use → idempotent commit; delta-based financial assertions) and the reason is recorded in `PROGRESS.md` |
| T-12 | CI fails when required checks fail | **PASS (configured)** | workflow steps are not `continue-on-error` |
| T-13 | No production secrets in workflow files or build logs | **PASS** | the workflow defines only test-database credentials for an ephemeral service container |
| T-14 | CI pipeline actually executed | **BLOCKED** | no GitHub remote or runner is reachable from this environment |

## H. Deployment and smoke test (`PRODUCTION_READINESS.md` Phases Twelve–Thirteen)

| ID | Requirement | Status | Evidence |
| -- | ----------- | ------ | -------- |
| P-1 | Architecture selected and documented | **PASS** | `docs/DEPLOYMENT.md`: same-origin nginx + API container + managed PostgreSQL, with two alternatives evaluated |
| P-2 | Deployment artefacts | **PASS (written) / BLOCKED (unbuilt)** | both Dockerfiles, compose stack, nginx config; **Docker is not installed here, so no image was built or run** |
| P-3 | Production frontend calls the correct backend URL | **PASS** | same-origin `/api` via nginx proxy; `VITE_API_URL` unset by default |
| P-4 | No hardcoded localhost production URLs | **PASS** | `CORS_ORIGIN`, `DATABASE_URL` and the API base come from configuration; the assertion in P-3 is what makes the default safe |
| P-5 | Debug endpoints and development tools not exposed | **PASS** | no debug route exists; the generated Prisma client is git-ignored and not served; the reset endpoint requires `RESET` and a session |
| P-6 | Demo data never inserted automatically | **PASS** | guard requires `BOOTSTRAP_DEFAULT_WORKSPACE=false`; verified on a clean database (smoke test step on the empty database) |
| P-7 | Production build contains no development secrets | **PASS** | Vite inlines only `VITE_*` variables; none hold secrets; the API bundle reads configuration at runtime |
| P-8 | Health and readiness behave as documented | **PASS** | verified in the smoke test and on a clean database |
| P-9 | Production-shaped end-to-end run | **PASS (local)** | 16 verified behaviours against a restored database with `NODE_ENV=production` and the guard active |
| P-10 | Deployed application over HTTPS, public URLs | **BLOCKED** | no provider, domain, database or credential was provided, and provisioning incurs cost without authorization |
| P-11 | Public smoke test with a safe test account | **BLOCKED** | depends on P-10 |
| P-12 | Deployment remains functional after a restart | **PASS (local)** | the API was killed with `SIGKILL` and restarted against the same database; the same session cookie still authenticated (`/auth/me` → `200`) and previously written rows were present. Sessions, previews and import idempotency live in the database, not in process memory |
| P-13 | No destructive or costly action taken without authorization | **PASS** | nothing was deployed, purchased, migrated or deleted outside scratch databases created for the drills |

## I. Phase Seven — optional zero-server installation

| ID | Requirement | Status | Evidence |
| -- | ----------- | ------ | -------- |
| Z-1 | Evaluate a zero-server/SQLite variant | **PASS (evaluated, not implemented)** | the specification marks this optional and it is not required for the PostgreSQL deployment. The blockers are recorded: raw SQL uses `date_trunc`, partial indexes and `::uuid` casts; the Prisma driver adapter is `pg`-specific; concurrent CSV import relies on server-side transactions. Implementing it would fork the data layer and the query surface |

## J. Non-critical deferrals

Explicitly deferred, with impact stated. None of these blocks the release gate.

| ID | Deferred item | Impact |
| -- | ------------- | ------ |
| X-1 | UI for refund linking, transfer pairing, category-rule editing, backup/restore and CSV export is not built; those features are API-only | A user must use the API (or a future release) for those actions. Chosen deliberately over shipping placeholder buttons; the API is fully tested and documented |
| X-2 | Multi-factor authentication | Password-only sign-in; mitigated by scrypt, rate limiting and session revocation |
| X-3 | Read audit log | No record of who read what; meaningful only if workspaces become shared |
| X-4 | Error-monitoring provider | Correlation via request id and logs only |
| X-5 | Multi-instance rate limiting and preview quota | Approximate limits with more than one API instance; correctness is unaffected (database-backed) |
| X-6 | `format:check` (122 files) | Not gated in CI; a pre-existing formatting gap, including files untouched by this work |
| X-7 | Docker image build and CI execution | Unverified locally; every command the images run was verified directly |

## K. Release gate

The gate is: no unresolved critical security, data-integrity, authentication,
migration or financial-calculation issue.

- **C-1, C-2, C-3** are fixed and verified.
- Security, isolation, migration and financial-integrity requirements are **PASS**
  with executed evidence.
- The remaining **BLOCKED** items are all environmental: no deployment provider or
  credentials (P-10, P-11, D-13, S-15, S-16), no GitHub runner (T-14), and no
  Docker on this machine (P-2, X-7).

**Conclusion.** SpendScope is production-*ready* as an application: the code,
schema, tests, configuration guardrails, CI definition and documentation are
complete, and everything that can be verified on this machine was verified. It is
**not deployed**, and no claim is made that it is, because the deployment and
public smoke test are blocked on authorization and credentials. The exact
remaining steps are in `docs/DEPLOYMENT.md` §"Remaining manual steps".
