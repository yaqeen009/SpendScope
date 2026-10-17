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

<!-- phases appended below as they complete -->
