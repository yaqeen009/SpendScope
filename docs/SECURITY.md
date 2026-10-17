# Security posture

SpendScope stores a person's complete financial history, so the security model is
about two things: **only the owner can read their data**, and **a total is never
wrong**. This document states what is in place, what is not, and which risks are
accepted. It describes the code in `apps/api` and `apps/web` as it exists.

## Threat model

| Asset | Threat |
| ----- | ------ |
| A workspace's transactions | Another authenticated user reading or changing them |
| An account | Password guessing, credential stuffing, stolen session cookies |
| A total, budget or export | A figure that silently mixes currencies, double-counts transfers, or over-counts a refund |
| The API process | Malicious CSV content, oversized bodies, injection through any input |
| Credentials and data | Leaking a secret through the repository or a log file |

Trusted: the database host, the reverse proxy. Untrusted: every HTTP request,
every uploaded file, and every restored backup document.

## What is in place

### Accounts and sessions

- Registration and sign-in are handled by `apps/api/src/modules/auth`. Passwords
  are hashed with `node:crypto` `scrypt` (N=16384, r=8, p=1, 64-byte key) and
  stored as `scrypt$N$r$p$salt$hash`. Password comparison is constant-time
  (`timingSafeEqual`).
- Sessions are opaque 256-bit random tokens. **Only the SHA-256 hash of a token
  is stored**, so a database dump does not yield a usable session. The token is
  delivered in an `HttpOnly` cookie with `SameSite=Lax` (configurable through
  `SESSION_COOKIE_SAME_SITE`) and `Secure` in production. A `SameSite=None`
  setting is refused at startup unless the cookie is also `Secure`, because
  browsers discard that combination — it would look like "login succeeds but the
  session never sticks".
- Sessions have an expiry (`SESSION_TTL_HOURS`, default 30 days), a `lastUsedAt`
  timestamp and the recording user agent. Users can list and revoke sessions
  (`GET /auth/sessions`, `DELETE /auth/sessions/:id`), and changing a password
  revokes every other session.
- Sign-in and registration are rate-limited by client address
  (`AUTH_RATE_LIMIT_MAX` per `AUTH_RATE_LIMIT_WINDOW_MINUTES`). Unknown email
  addresses still perform a dummy `scrypt` verification, so response time does
  not reveal whether an account exists.
- A failed sign-in returns the same message for an unknown address and a wrong
  password.

### Authorisation and workspace isolation

- Every data route is mounted behind `protectedApi` (`apps/api/src/app.ts`), so a
  missing or expired session returns `401` before any handler runs.
- The workspace is resolved **from the session**, never from the request.
  `middleware/workspace.ts` attaches the caller's workspace, and every query uses
  that id. A caller cannot name another workspace, and a row id belonging to
  another workspace resolves to `404`.
- `apps/api/tests/isolation.test.ts` proves this with two real accounts, and the
  deployed smoke test repeats it.

### CSRF

Layered defences: `SameSite=Lax` cookies (the default), an `Origin`/`Referer`
check on every state-changing request (`middleware/csrf.ts`, returns `403`), and
CORS restricted to the origins in `CORS_ORIGIN`. A foreign origin receives no
CORS headers **and** a clean `403` rather than an error.

When the SPA is served from a different origin than the API, CORS sends
`Access-Control-Allow-Credentials: true` **for allow-listed origins only** — never
for `*` — and the SPA calls the API with `credentials: 'include'`. The origin
allow-list is still enforced by the origin callback on every request, and
`requireTrustedOrigin` re-checks it on state-changing requests, so a misconfigured
or hostile origin cannot ride the credential allowance. On the recommended
single-origin deployment (the web service proxies `/api`) none of this is
exercised by the browser at all.

### HTTP hardening

- `helmet` with defaults (HSTS, `nosniff`, `Referrer-Policy`, frameguard) and
  `crossOriginResourcePolicy: same-site`. CSP is disabled on the API because it
  serves JSON and CSV. The SPA's security headers and CSP come from
  `apps/web/security-headers.inc` (nginx) or, on a platform without a web server,
  from `apps/web/server.mjs`, which emits the same values and widens `connect-src`
  only when `CSP_CONNECT_SRC` lists the API origin.
- `x-powered-by` disabled. `trust proxy` is configurable (`TRUST_PROXY`) so client
  IPs are correct behind a proxy without letting a direct caller spoof
  `X-Forwarded-For`.
- CORS restricted to the origins in `CORS_ORIGIN`.
- Body size capped at `MAX_UPLOAD_BYTES` (default 5 MiB) for JSON and CSV.
- Rate limits: imports 30/min, other write routes 120/min, auth as above.
- Request ids (`x-request-id`) are generated per request, reused from a trusted
  edge when supplied, and echoed in every response and error body.
- Server timeouts are explicit (`requestTimeout` 120s, `headersTimeout` 20s,
  `keepAliveTimeout` 65s).
- Errors return `{ error: { code, message, details?, requestId } }`. Internal
  errors log the stack with pino and return a generic message, so SQL, paths and
  stack traces never reach the client.

### Financial integrity controls

These are correctness controls, and a wrong total is a security-relevant failure:

- All arithmetic uses `decimal.js` through Prisma `Decimal(14,2)`. No floating
  point in any total.
- **No currency conversion exists anywhere.** Each row is in the workspace base
  currency (`currency IS NULL`) or in an explicitly named foreign currency.
  Every aggregate filters to the base currency, and the analytics summary reports
  the excluded rows by currency so a total is never presented as complete when it
  is not. See `docs/DECISIONS.md`.
- A refund must be linked to a real expense, inherits its category and currency,
  and **over-refunding is rejected** with the remaining amount in the message.
- Transfers are excluded from income and expense totals, and manual pairing
  requires the same amount, the same currency, and no existing pairing.
- Category rules only fill a *missing* category. They never overwrite a value the
  user or the import provided.
- Import commit is idempotent: a replay returns the recorded result instead of
  importing the rows twice.

### Input validation

Every body, query and path parameter is validated with a Zod schema from
`@spendscope/shared` before a service runs. CSV is parsed by a purpose-built
parser; no cell is ever executed, evaluated or interpolated into SQL. Database
access is Prisma or parameterised tagged-template SQL.

### CSV injection

The export (`csvCell` in `apps/api/src/modules/exports/exports.service.ts`)
prefixes any cell beginning with `=`, `+`, `-`, `@`, tab or carriage return with
an apostrophe, so a description imported from a bank file cannot become a formula
when the export is opened in a spreadsheet. Restored backups are validated with a
Zod schema before any row is written.

### Secrets and configuration

- `.env` is git-ignored; `.env.example` holds placeholders only. The generated
  Prisma client is git-ignored.
- The production configuration guard (`apps/api/src/config/env.ts`) **refuses to
  start** when `NODE_ENV=production` and the configuration is unsafe: a loopback
  CORS origin, a non-HTTPS origin, a local database, an insecure session cookie,
  or automatic workspace bootstrapping. Each check has one explicit,
  self-documenting override (`ALLOW_LOCAL_DATABASE_IN_PRODUCTION`,
  `ALLOW_INSECURE_COOKIES`, `SESSION_COOKIE_SECURE`). The guard's rules are unit
  tested in `apps/api/src/config/env.test.ts`.
- Development, test and production differ only by `NODE_ENV` and the values
  supplied. The test suite uses a separate `TEST_DATABASE_URL` and refuses to run
  when it equals `DATABASE_URL`.

### Logging and privacy

- Logs are structured (pino) and contain method, path, status, error code,
  request id and duration. **Request and response bodies are never logged**, so
  descriptions, merchants and amounts do not enter the log stream. Health checks
  are excluded from access logging to keep the noise down.
- The redaction rule list is exported as `REDACT_PATHS` and asserted by a unit
  test. It covers the request and response `Cookie`/`Set-Cookie` headers as well as
  the financial fields: the session token is issued in `Set-Cookie`, and logging
  response headers without that rule writes a live session to the log sink. This
  was found by the Railway topology smoke test and fixed
  (`docs/PRODUCTION_TEST_REPORT.md`).
- The web server logs one JSON line per request — method, path (never the query
  string, which can contain user-entered search terms), status and duration. It
  logs no header values and no bodies.
- There is no telemetry, no analytics, no crash reporting and no third-party API
  call at runtime. The SPA's CSP allows `connect-src 'self'` by default, and is
  widened only for an explicitly configured API origin, which keeps it that way.
- Pending import previews — which do contain financial rows — are stored in the
  `ImportPreview` table, scoped to a workspace, with a TTL (default 30 minutes)
  and a cap of 25 per workspace. Expired rows are swept at startup and hourly.

### Destructive operations are explicit

- Deleting an account (`DELETE /auth/me`) requires the literal token `DELETE`
  **and** the account password, and deletes the account with every workspace it
  owns in one transaction.
- The workspace reset endpoint requires the exact confirmation string `RESET`.
- "Clear sample data" deletes only rows marked `isSample`, never imported data.
- Restore requires `mode` and `confirm: 'RESTORE'`, and is workspace-scoped: it
  cannot touch another workspace's rows.

## Personal data stored

| Data | Where | Why |
| ---- | ----- | --- |
| Email, display name | `User` | Sign-in and identification |
| Password (scrypt hash only) | `User.passwordHash` | Authentication |
| Session hash, expiry, user agent | `Session` | Keep the user signed in; let them see and revoke devices |
| Transactions: date, description, merchant, amount, notes, category | `Transaction` | The product's purpose |
| Imported file name, row counts, mapping | `ImportBatch` | Let the user audit what was imported |
| Parsed CSV rows awaiting confirmation | `ImportPreview` | Import preview; expires in 30 minutes |
| Budgets, categories, rules, settings | `Budget`, `Category`, `CategoryRule`, `Settings` | Product features |

No data is sent anywhere. There is no third-party processor, so there is no data
processing agreement to make.

**Export.** `GET /exports/transactions.csv` (filtered) and
`GET /exports/backup.json` (full workspace, portable) let a user take all of
their data out at any time.

**Deletion.** `DELETE /auth/me` with the password removes the account, its
sessions and every workspace it owns, cascading through every child table. This
is irreversible and requires the password for that reason. Deleting a single
workspace's data (keeping the account) is the same operation on a narrower scope
and is not exposed in the UI; the documented procedure is to export first, then
delete the account.

## What is NOT in place, and why

### No TLS inside the application

The API speaks plain HTTP and expects a TLS-terminating proxy or platform load
balancer in front of it. HSTS and the SPA's security headers belong on that layer
(see `docs/DEPLOYMENT.md`). The production guard requires HTTPS origins and a
`Secure` cookie, which is what makes this arrangement safe rather than optional.

### No multi-factor authentication

Sign-in is password-only. Deferred: it needs a provider decision and recovery
flows, which are product decisions rather than missing code. Mitigations in place
are scrypt hashing, rate limiting, session listing and revocation, and password
change invalidating other sessions.

### No encryption at rest beyond the platform's

Database files are as protected as the host and the managed database service make
them. Enable disk encryption on a self-hosted host, or use a managed service that
encrypts volumes by default. SpendScope adds no layer of its own.

### No audit log of reads

The `ImportBatch` table records writes. Who read what is not recorded. For a
single-user-per-workspace model, a read audit has no second party to attribute
reads to; it becomes meaningful only if workspaces are ever shared.

### No error-monitoring provider

Errors are logged with a request id that the client also receives, so an operator
can correlate a report with a log line. No third-party error tracker is
configured, deliberately, because it would receive financial context.

### Duplicate detection is heuristic

Fingerprint matching can miss a genuine duplicate (visible as two rows the user
can delete) or, in principle, suppress a legitimate repeated payment. It never
merges or deletes rows on its own.

## Accepted risks

| Risk | Accepted because |
| ---- | ---------------- |
| A stolen session cookie grants access until expiry or revocation | Standard for cookie sessions; `HttpOnly` + `Secure` + `SameSite` limit theft, and the user can revoke sessions |
| An operator with database access can read all data | Unavoidable without per-user encryption keys; documented in `docs/DEPLOYMENT.md` |
| Ambiguous `DD/MM` dates are parsed day-first | Data-correctness trade-off; documented in `docs/DECISIONS.md` |
| A wrong or stale exchange rate would corrupt totals | Eliminated by design: conversion is disabled and foreign rows are excluded instead |
| `style-src 'unsafe-inline'` in the SPA CSP | Required by the charting library; no inline script is allowed |
| Serving the SPA from a different origin than the API weakens CSRF defence | Only needed for two public domains; mitigated by the origin check on state-changing requests plus `SameSite=None; Secure`, and avoidable by proxying `/api` from the web service |

## Dependency audit

`npm audit --omit=dev` reported **0 vulnerabilities** at the time of the final
audit (`docs/PRODUCTION_TEST_REPORT.md` records the command and date). CI installs
from the committed lockfile with `npm ci`.

## Reporting

Open an issue in the repository. Do not include real financial data, session
tokens or connection strings in a report.

## Hardening checklist before any non-loopback deployment

1. Serve over HTTPS and set `HSTS` at the TLS terminator.
2. Set `SESSION_COOKIE_SECURE=true`, an HTTPS `CORS_ORIGIN`, keep
   `SESSION_COOKIE_SAME_SITE=lax` (one origin, or matching subdomains), and keep
   `BOOTSTRAP_DEFAULT_WORKSPACE=false`.
3. Use a managed or least-privilege database role — not `postgres`, and not trust
   auth. Keep the database unreachable from the internet.
4. Set `TRUST_PROXY` to the real number of proxies so rate limiting sees the
   client address.
5. Decide whether public registration stays open (`ALLOW_REGISTRATION`).
6. Enable automated database backups and perform a restore drill
   (`docs/DATA_BACKUP_AND_RESTORE.md`).
7. Keep the API reachable only through the proxy.
8. Confirm the production configuration guard passes, rather than overriding it.
