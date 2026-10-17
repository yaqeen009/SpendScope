# Deployment

This document is the deployment reference for SpendScope: the architecture that
was chosen and why, the production configuration, the migration procedure, the
backup and rollback procedures, and a deployment checklist.

> **Status.** The deployment files are complete and were exercised locally as a
> production-shaped stack (`docs/PRODUCTION_TEST_REPORT.md`). No cloud provider,
> database, domain or deployment credential has been provided or authorized, so
> **nothing has been deployed to a public environment**. Section
> [Remaining manual steps](#remaining-manual-steps) lists exactly what is needed
> to finish, and section [Rollback](#rollback) is the plan to follow when it is
> done.

## Architecture

### What the application actually needs

| Requirement | Consequence for the platform |
| ----------- | ---------------------------- |
| Long-running Node process (`express`, in-process timers for session and preview pruning) | Not a fit for a pure request/response serverless function |
| PostgreSQL with `date_trunc`, partial indexes, `uuid` casts, `DECIMAL` | Managed PostgreSQL (v14+; developed and tested against 18) |
| A multi-megabyte CSV upload parsed in memory | Request body limit raised to 12 MB at the proxy, not a 1 MB default |
| Cookie sessions | The SPA and the API should share an origin, or at least a registrable domain |
| npm workspace monorepo (API + web + shared package) | Build from the repository root, not from a subdirectory |
| No third-party service at runtime | No egress rules to write, no vendor account to provision |

### Options evaluated

1. **One origin: nginx serves the SPA and proxies `/api` to the API; managed
   PostgreSQL.** ← **chosen as the reference architecture.**
   One deployment unit for the browser to talk to, so the session cookie is
   same-site, CSRF is simple, and there is no CORS surface to misconfigure. The
   API is still a separate container/process, so each part scales and restarts
   independently. This is the shape `docker-compose.yml` builds and the shape the
   local production smoke test exercised.
2. **Static SPA on a CDN + API container + managed PostgreSQL.** Better for very
   high static traffic. Costs more configuration than it saves here: the API
   needs its own hostname, `VITE_API_URL` must be set at build time, `CORS_ORIGIN`
   must list the CDN origin, and if the API is on a *different registrable domain*
   the session cookie has to become `SameSite=None; Secure`, which weakens CSRF
   defence and is not the default. Choose this only if the SPA's static traffic
   justifies it.
3. **Serverless platform for the API + managed serverless PostgreSQL.** Workable,
   but the API holds in-process state (rate-limit counters and the pruning timer)
   and expects a long-lived process; the pruning timer would need an external
   scheduler. No advantage for a single-instance workload.

### Reference architecture

```
          HTTPS 443
browser ───────────────►  web container (nginx)
                            ├── /            → static SPA (built assets)
                            ├── /assets/*    → immutable, 1-year cache
                            └── /api/*       → proxy → api container :4000
                                                     │
                                                     ├── 5432 → managed PostgreSQL (TLS)
                                                     └── stdout → platform log collector
```

- **Frontend + API hosting:** the two images in this repository
  (`apps/web/Dockerfile`, `apps/api/Dockerfile`), run as two services on any
  container host (Fly.io, Render, Railway, ECS, a plain VM behind a load
  balancer). Both build from the repository root as the Docker build context.
- **Database hosting:** a managed PostgreSQL service with automated backups and
  point-in-time recovery (for example RDS, Cloud SQL, Neon, Supabase, Fly
  Postgres). Do not run the database in the same container as the API, and do not
  expose it to the internet.
- **TLS:** terminated at the platform's load balancer or at nginx. HSTS belongs
  at that layer; the SPA's security headers and CSP are set by
  `apps/web/security-headers.inc`.
- **Production URLs:** one public hostname for both the SPA and the API, for
  example `https://spendscope.example.com`, with `/api/*` proxied. Because they
  share an origin there is no CORS origin to configure for the browser's own
  requests, and no authentication callback URL to register — SpendScope uses
  first-party cookie sessions, not an external identity provider.

## Production configuration

Every variable is documented in `.env.example`. The values that matter in
production:

| Variable | Production value | Notes |
| -------- | ---------------- | ----- |
| `NODE_ENV` | `production` | Enables the configuration guard and `Secure` cookies |
| `DATABASE_URL` | managed PostgreSQL URL | Add `?connection_limit=5&pool_timeout=10` for a small instance; **no** `ALLOW_LOCAL_DATABASE_IN_PRODUCTION` override |
| `CORS_ORIGIN` | `https://spendscope.example.com` | Must be `https://`. Add extra origins comma-separated only if a second origin really exists |
| `SESSION_COOKIE_SECURE` | `true` | Not optional with HTTPS |
| `SESSION_COOKIE_NAME` | `spendscope_session` | Change only if it collides with another app on the same domain |
| `SESSION_TTL_HOURS` | `720` (30 days) or lower | Shorter means more re-sign-ins |
| `TRUST_PROXY` | `1` behind one proxy/load balancer | Must match reality or rate limiting sees the proxy's IP |
| `LOG_LEVEL` | `info` | `warn` in noisy environments |
| `BOOTSTRAP_DEFAULT_WORKSPACE` | `false` | `true` would create an unowned workspace on start |
| `ALLOW_REGISTRATION` | `true`, or `false` once your account exists | Closing it is the simplest way to keep a personal deployment private |
| `ALLOW_LOCAL_DATABASE_IN_PRODUCTION` | unset | Setting it acknowledges a non-production run |
| `ALLOW_INSECURE_COOKIES` | unset | Same |
| `MAX_UPLOAD_BYTES` | `5242880` | Must stay below the proxy's `client_max_body_size` |
| `VITE_API_URL` | unset | Same-origin. Set only for the CDN architecture in option 2 |

Secrets: `DATABASE_URL` contains the database password. Supply it through the
platform's protected environment variables or secret store — never in the image,
never in the repository, never in a CI workflow file.

The API refuses to start when `NODE_ENV=production` and the configuration is
unsafe; the message names each problem. That check is the last line of defence
against a deployment that serves financial data over an insecure origin.

### Production checklist

- [ ] `NODE_ENV=production` and the API starts without a configuration warning.
- [ ] `GET /api/v1/health` returns `200` (liveness) and
      `GET /api/v1/health/ready` returns `200` with `database: "up"`.
- [ ] The SPA loads over HTTPS and a hard refresh on a deep route (for example
      `/transactions`) still loads the app.
- [ ] Registration and sign-in work, the session cookie has `HttpOnly`, `Secure`
      and `SameSite=Lax`, and sign-out returns `401` on a protected route.
- [ ] Two accounts cannot see each other's transactions.
- [ ] A CSV imports, and importing the same file again does not duplicate rows.
- [ ] An export contains only the signed-in workspace's rows.
- [ ] Logs contain request ids and no transaction descriptions, merchants or
      amounts.
- [ ] Backups are configured at the database level **and** a restore was drilled.

## Build and start commands

Local development is in `README.md`. For a container deployment:

```bash
# API image (build context is the repository root)
docker build -f apps/api/Dockerfile -t spendscope-api .

# Web image
docker build -f apps/web/Dockerfile -t spendscope-web .

# Migrations: run the `migrate` target once per release, before the new API starts
docker build -f apps/api/Dockerfile --target migrate -t spendscope-migrate .
docker run --rm -e DATABASE_URL="$DATABASE_URL" spendscope-migrate
```

Without Docker:

```bash
npm ci
npm run db:generate                  # Prisma client
npm run build                        # API bundle (tsup) + web bundle (vite)
npm run start                        # node apps/api/dist/server.js
```

The web bundle is static: serve `apps/web/dist` with nginx (or any static host)
and proxy `/api` to the API.

## Database migrations

- Migrations live in `apps/api/prisma/migrations` and are committed. They are
  applied with `prisma migrate deploy`, which is **additive and idempotent** — it
  never drops or rewrites data and skips already-applied migrations.
- Apply migrations as a separate step *before* the new application version
  starts. `docker-compose.yml` does this with a one-shot `migrate` service that
  the API waits for (`service_completed_successfully`).
- Migrations are deliberately backward compatible for one release: they add
  nullable columns, new tables and indexes, so the previous application version
  keeps working while the new one rolls out.
- Verified from an empty database: 9 migrations applied, 13 tables created, and
  the API started with `database: "up"` against it
  (`docs/PRODUCTION_TEST_REPORT.md`).
- **Never** run `prisma migrate reset`, `prisma db push --force-reset` or
  `npm run db:seed` against production. Seeding is explicit development tooling;
  the application never seeds automatically, and `BOOTSTRAP_DEFAULT_WORKSPACE`
  must be `false`.

### Rolling back a schema change

There is no down-migration, by design: a down-migration that drops a column
destroys data that the previous version may need. Instead:

1. Roll back the **application** (see [Rollback](#rollback)). The previous version
   runs correctly against the new schema, because migrations in a release are
   additive.
2. If a migration must be undone, write a new forward migration that reverses it,
   review it, and apply it through the same `migrate deploy` path. Never edit an
   already-applied migration: Prisma checksums it.

## Health checks

| Endpoint | Purpose | Behaviour |
| -------- | ------- | --------- |
| `GET /api/v1/health` | Liveness | Always `200`, no database access. Use it to decide whether to restart the process; a database outage must not cause a restart loop. |
| `GET /api/v1/health/ready` | Readiness | Runs `SELECT 1`. `200` with `database: "up"` when ready, `503` when the database is unreachable. Use it to decide whether to route traffic. |

Both are excluded from access logging. The API image also has a Docker
`HEALTHCHECK` that polls liveness.

## Backups and restore

Full procedures, retention policy and the recorded restore drill are in
[`docs/DATA_BACKUP_AND_RESTORE.md`](DATA_BACKUP_AND_RESTORE.md). In short:

- Enable the managed database's automated backups with point-in-time recovery;
  7 days of retention is a reasonable minimum, 30 days for a real financial
  history.
- The application adds a user-facing layer: `GET /api/v1/exports/backup.json`
  produces a portable, workspace-scoped document, and
  `POST /api/v1/exports/restore` restores one. That is a convenience and a
  migration path, **not** a substitute for database backups.

## Rollback

Application rollback (the common case — a bad release, no schema problem):

```bash
# Re-deploy the previous image tag, then confirm:
curl -fsS https://spendscope.example.com/api/v1/health
curl -fsS https://spendscope.example.com/api/v1/health/ready
```

1. Roll the API back to the previous image tag. Wait for the readiness probe to
   pass.
2. Roll the web image back if the bundle changed. `index.html` is served
   `no-store`, so browsers pick up the previous bundle on the next load.
3. Do **not** roll migrations backwards. Releases are additive for one version,
   so the previous application runs on the new schema.
4. If data was corrupted by the release, restore the database from a backup
   **after** rolling the application back, and only after recording what was
   lost: recovery restores the whole database, so anything written after the
   backup point is also lost.
5. Verify: sign in, load the dashboard, export a CSV, and confirm the row counts
   match the pre-incident numbers.

## Service limitations and costs

- **Single API instance assumptions.** Rate limiting and the import-preview
  *quota* are counted in-process. Running several API instances makes rate limits
  approximate (each instance counts its own) and transiently lets a workspace
  hold up to *n* × 25 previews. Import correctness is unaffected: previews and
  idempotency are database-backed. Fix by moving the counters to Redis if a
  multi-instance deployment is needed.
- **In-process timers.** Session and preview pruning run on a timer inside the
  API process. A serverless deployment would need an external scheduler instead.
- **Upload and export size.** `MAX_UPLOAD_BYTES` caps the upload (5 MiB by
  default, 12 MB at the proxy). Exports are capped at 50,000 rows per file and
  set `X-Total-Truncated: true` when they are cut short, so a large export is a
  paged download rather than one giant file.
- **Cost shape.** The dials are the container size (a 512 MB / 0.25 vCPU instance
  is comfortable: a 24-month summary over 50,000 transactions completes in about
  53 ms) and the managed database's smallest tier. No third-party service is
  required, so there is no per-seat or per-event cost.
- **Data residency.** The only place data lives is the database you choose. Pick
  a region deliberately; there is no other copy.

## Remaining manual steps

These require credentials or authorization that have not been provided, and are
the only things standing between this repository and a verified deployment:

1. **Choose a provider and create the resources** (API container host, web
   container host, managed PostgreSQL). This has a cost implication, so it needs
   your approval.
2. **Provide `DATABASE_URL`** for the production database through the platform's
   secret store, plus `CORS_ORIGIN` for the real hostname and `TRUST_PROXY` for
   the real proxy count.
3. **Register the domain** and point it at the load balancer, then enable
   managed TLS. This is the step that cannot be done or verified from here.
4. **Add the deployment workflow** (or run the `docker build` / `docker push` /
   platform deploy commands from section
   [Build and start commands](#build-and-start-commands)) and run
   `migrate deploy` as a pre-deploy step.
5. **Run the production smoke test** from `PRODUCTION_READINESS.md` §15 against
   the public URLs with a test account, and record the result in
   `docs/PRODUCTION_TEST_REPORT.md`. Until this is done, the deployment is
   unverified, and no claim is made that SpendScope is production-ready.
