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

<!-- phases appended below as they complete -->
