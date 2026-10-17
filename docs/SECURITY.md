# Security posture

SpendScope is a **single-user, local-first** application. It is designed to run
on your own machine, against your own private PostgreSQL cluster, with your data
never leaving the machine. This document states what is protected, what is
**not**, and which risks are accepted.

## Threat model

| Trusted | Untrusted |
| ------- | --------- |
| The machine it runs on | The network (localhost only) |
| The local database | Uploaded CSV files (parsed as data, never executed) |
| The user's browser session | Anything on a non-loopback interface |

The design goal is **data privacy**, not multi-user security. SpendScope holds
your complete financial history; the risk that matters most is that history
leaving the machine or being readable by a local process you did not intend.

## What is in place

### No external services

There is no telemetry, no analytics, no crash reporting, no cloud sync, and no
third-party API call at runtime. Data goes from your CSV into your PostgreSQL
and is read back by your browser. This is the primary privacy guarantee.

### No secrets in the repository

- `.env` is git-ignored; `.env.example` contains placeholders only.
- The bundled Prisma client (`apps/api/src/generated/prisma`) is git-ignored and
  regenerated locally.
- The local Postgres uses **trust auth over loopback** with **no password**, so
  there is no credential to leak. The trade-off is documented below.

### Database is private and local

The cluster's data directory is `~/.spendscope/pgdata` and it listens on
`localhost:5433` only. There is no system service and no external listener.

### HTTP hardening

The Express app (`apps/api/src/app.ts`) applies:

- `helmet` with safe defaults (CSP disabled because the API serves JSON and CSV,
  not HTML; `crossOriginResourcePolicy: same-site`).
- `x-powered-by` disabled and `trust proxy` disabled (`trust proxy: false`, so
  `X-Forwarded-*` headers cannot spoof the client).
- **CORS restricted** to the configured origin(s) from `CORS_ORIGIN`; requests
  with no `Origin` header (same-origin, `curl`) are allowed, credentials are not
  sent (`credentials: false`).
- **Rate limiting**: imports are capped at 30 requests/minute; other write
  routes (transactions, categories, budgets, settings) at 120 requests/minute.
  Analytics and health are not rate-limited.
- **Body size cap** of `MAX_UPLOAD_BYTES` (default 5 MiB) on JSON bodies and on
  the CSV payload, so a large or malformed upload cannot exhaust memory.

### Input validation

Every request is validated with Zod schemas from `@spendscope/shared` before it
reaches a service. CSV content is treated strictly as data: it is parsed with a
purpose-built CSV parser, row values are coerced through explicit date and money
parsers, and no cell is ever evaluated, executed or interpolated into SQL.
Database access is through Prisma or parameterised tagged-template queries.

### Resource limits

- Imports are capped at 20,000 rows.
- Only the first 200 preview rows are returned to the browser.
- Previews expire after 30 minutes (configurable) and at most 25 are retained.

### Error handling

Errors return a uniform `{ error: { code, message, details? } }` envelope. In
production, internal errors are logged with structure (pino) and the client
receives a generic message rather than a stack trace or SQL detail.

### Destructive operations are explicit

The workspace reset endpoint requires the exact confirmation string `RESET` and
explicit flags for what to include. "Clear sample data" deletes only rows marked
`isSample`, never imported data.

## What is NOT in place (and why)

### No authentication or authorisation

**This is the largest limitation.** There are no accounts, sessions, tokens or
password checks. Any process that can reach the API has full read/write access
to every workspace in the database.

Why: the app is single-user and local by design; adding an auth layer to an
app with no users would be security theatre without a threat to defend against.

**Consequence.** The API binds to localhost and must **never** be exposed to a
LAN, a VPN, a container network, or the public internet — not even "temporarily"
or "just for testing". If you need remote access, put an authenticating reverse
proxy in front of it and terminate TLS there. The schema already carries
`workspaceId` on every row, so adding real auth later is a scoping change, not a
rewrite.

### No TLS

Traffic between the browser and the API is plain HTTP on localhost. That is fine
for loopback and unacceptable anywhere else. No certificate is shipped.

### Trust auth on the local database

Any local process running as your user can connect to Postgres as `postgres`
with no password. Accepted because the cluster is loopback-only, on a machine
you control, holding development data. For a shared or production machine, use
`scram-sha-256` with a real password and a least-privilege role.

### No encryption at rest

The database files and any CSV you keep are plain files on your disk. Use full
disk encryption (FileVault, LUKS, BitLocker). SpendScope adds no layer of its
own.

### No audit log of reads

Write activity is recorded (`ImportBatch`), but there is no record of who read
what. With no accounts, there is nothing to attribute reads to.

### No CSRF protection

Requests are not protected by CSRF tokens. CORS restricts which origins the
browser will let a script read responses from, but a local process can still
issue requests directly. Authentication is what makes CSRF meaningful; without
it, CSRF is not the weakest link.

### In-memory preview store is per-process

Pending import previews live in the API process memory. They vanish on restart
and are not shared between instances. This is a functional limitation rather
than a security one; previews are validated again at commit time.

## Accepted risks

| Risk | Accepted because |
| ---- | ---------------- |
| Local process reads the database | Lead risk; mitigated only by disk encryption and machine access control |
| Ambiguous `DD/MM` dates parsed day-first | Data-correctness trade-off, not security; documented |
| Duplicate detection is heuristic | False negatives surface as visible duplicates the user can delete |
| Trust auth on loopback | Cluster is local-only, data is development data |

## Reporting

This is a local development application; there is no security team or private
disclosure process. If you find an issue, open it in the repository. Do **not**
deploy SpendScope as-is to anywhere reachable by others.

## Hardening checklist before any non-loopback use

1. Add real authentication and bind each workspace to an authenticated user.
2. Put the API behind a reverse proxy that terminates TLS.
3. Restrict CORS to the real frontend origin only.
4. Replace trust auth with `scram-sha-256` and a least-privilege role.
5. Keep the API firewalled from every interface except the proxy.
6. Enable full disk encryption on the host.
