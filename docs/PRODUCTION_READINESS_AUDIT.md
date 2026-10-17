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
`PROGRESS.md` and the final audit in `docs/PRODUCTION_TEST_REPORT.md`.
