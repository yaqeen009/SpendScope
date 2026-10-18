# Deployment

This document is the deployment reference for SpendScope: the architecture that
was chosen and why, the production configuration, the migration procedure, the
backup and rollback procedures, and a deployment checklist.

> **Status.** The deployment files are complete and were exercised locally as a
> production-shaped stack (`docs/PRODUCTION_TEST_REPORT.md`). No cloud provider,
> database, domain or deployment credential has been provided or authorized, so
> **nothing has been deployed to a public environment**. Railway is the initial
> hosting target and the step-by-step guide is in
> [Deploying to Railway](#deploying-to-railway-step-by-step). Section
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

## Deploying to Railway (step by step)

Railway as the first hosting target: three resources in one Railway project.
This section is written for someone who has never deployed anything, and it
assumes nothing has been deployed yet.

### What gets deployed

| Railway resource | What it is | Public? |
| ---------------- | ---------- | ------- |
| `Postgres` | Railway's PostgreSQL plugin | No — reachable only on the private network |
| `api` | Node service running `apps/api/dist/server.js` | **No** (recommended) |
| `web` | Node service serving the built SPA and proxying `/api` to `api` | Yes |

The browser talks to the `web` service only. That matters because the session is
an `HttpOnly` cookie: on a single origin the cookie is same-site, no CORS rule is
exercised, `SameSite=Lax` keeps doing its CSRF work, and the API needs no public
domain at all. The `web` service forwards `/api/*` to the API over Railway's
private network.

Both services build from the **repository root**. This is an npm workspace
monorepo: `apps/api` and `apps/web` both depend on `packages/shared`, the lockfile
is at the root, and the Prisma config lives at `apps/api/prisma.config.ts`. A
Railway "root directory" of `apps/api` would break the install; instead the root
directory stays `/` and each service gets an explicit build command that targets
one workspace.

> Railway's Config-as-Code files (`railway.json` / `railway.toml`) are deprecated
> and new services cannot opt into them, so this guide uses the service settings
> in the dashboard, which is where the same values live.

### 1. Create the project and the database

1. In Railway: **New Project → Deploy from GitHub repo**, and pick this
   repository. Railway creates one service; rename it to `api` (service name
   matters: it becomes the private hostname `api.railway.internal`).
2. **New → Database → Add PostgreSQL**. Leave the service name as `Postgres`, so
   the reference variable `${{Postgres.DATABASE_URL}}` below resolves. It needs
   no public networking.
3. **New → GitHub Repo** → the same repository again. Rename this service to
   `web`.
4. Do not add a volume. SpendScope keeps nothing on the filesystem: CSV uploads
   are parsed in memory, import previews and all financial data live in
   PostgreSQL, and the built SPA is in the deployment image.

### 2. Configure the `api` service

Open the `api` service → **Settings**:

| Setting | Value |
| ------- | ----- |
| Root Directory | `/` (leave empty / repository root) |
| Build Command | `npm ci --include=dev && npm run db:generate && npm run build --workspace @spendscope/api` |
| Start Command | `npm run start --workspace @spendscope/api` |
| Pre-Deploy Command | `npm run db:deploy` |
| Healthcheck Path | `/api/v1/health` |
| Watch Paths | `apps/api/**`, `packages/**`, `package.json`, `package-lock.json` |

Why each value:

- `npm ci --include=dev`: the build needs `tsup` and the Prisma CLI, which are
  dev dependencies. Railway sets `NODE_ENV=production` for builds, and without
  `--include=dev` those tools are absent and the build fails.
- `npm run db:generate`: the generated Prisma client is git-ignored
  (`apps/api/src/generated/`), so it must be regenerated in every build.
- `npm run db:deploy` as the **pre-deploy** step: it runs
  `prisma migrate deploy` in a separate container once per release, before the new
  version takes over. A failing migration stops the deployment instead of serving
  the new code against an old schema. `prisma` is a runtime dependency of the API
  for exactly this reason. If your project layout cannot set a pre-deploy step,
  use `npm run db:deploy && npm run start --workspace @spendscope/api` as the
  start command instead — `migrate deploy` is idempotent, so a restart is safe.
- `PORT` is **not** hardcoded anywhere in the code: the API reads `env.PORT`. Set
  it explicitly to `4000` in the variables below so the private URL the `web`
  service uses is deterministic, and Railway's edge routes to the same port. To
  let Railway pick the port instead, remove `PORT` and set
  `API_INTERNAL_URL` on `web` to `http://${{api.RAILWAY_PRIVATE_DOMAIN}}:<that port>`.
- No public networking on this service. Add a domain only if you deliberately
  want the API reachable from the internet.

**Variables** (Service → Variables → *Raw Editor* is quickest):

```
NODE_ENV=production
PORT=4000
DATABASE_URL=${{Postgres.DATABASE_URL}}
CORS_ORIGIN=https://<the web service's domain>
SESSION_COOKIE_SECURE=true
SESSION_COOKIE_SAME_SITE=lax
TRUST_PROXY=1
BOOTSTRAP_DEFAULT_WORKSPACE=false
ALLOW_REGISTRATION=true
LOG_LEVEL=info
```

- `DATABASE_URL` must be present at **build** time as well as at runtime: the
  Prisma config resolves it when `prisma generate` runs. Railway makes service
  variables available to both the build and the runtime, so the reference
  variable works for both. (Referencing the database's `DATABASE_URL` gives the
  private host; that is the one to use.)
- `CORS_ORIGIN` must be the real `https://` origin of the web service. If the web
  service's Railway domain is generated later, paste it in afterwards — or use
  `CORS_ORIGIN=https://${{web.RAILWAY_PUBLIC_DOMAIN}}`, which stays in sync when
  the domain changes.
- `TRUST_PROXY=1`: exactly one proxy rewrites `X-Forwarded-For` on the way to the
  API (the `web` service; the Railway edge's own entry is replaced, not appended).
  Rate limiting then sees the real client address. Never set this to `true`.
- `BOOTSTRAP_DEFAULT_WORKSPACE=false` is not optional. The startup guard refuses
  to run in production with it enabled, because it would create an unowned
  workspace. Nothing is ever seeded automatically.
- Leave `ALLOW_LOCAL_DATABASE_IN_PRODUCTION` and `ALLOW_INSECURE_COOKIES` unset.
  They exist only for the deliberate local, production-shaped stack.

Deploy (`api` first, so the schema exists before the web service is reachable).

### 3. Configure the `web` service

| Setting | Value |
| ------- | ----- |
| Root Directory | `/` |
| Build Command | `npm ci --include=dev && npm run build --workspace @spendscope/web` |
| Start Command | `npm run start:web` |
| Healthcheck Path | `/health` |
| Watch Paths | `apps/web/**`, `packages/**`, `package.json`, `package-lock.json` |

**Variables**:

```
API_INTERNAL_URL=http://api.railway.internal:4000
HSTS_MAX_AGE=31536000
LOG_LEVEL=info
```

- `API_INTERNAL_URL` is what makes this a single-origin deployment: the static
  server proxies `/api/*` to that address over Railway's private network. If it
  is unset the server still serves the SPA, but `/api` answers
  `404 NO_API_UPSTREAM`.
- `PORT` may be set (for example `3000`) or left unset; the server reads it from
  the environment either way.
- `HSTS_MAX_AGE` is optional and only belongs here once the domain is served over
  HTTPS. Remove it if you ever need plain HTTP again for testing.
- If you set `VITE_API_URL`, the SPA calls that origin directly instead of the
  proxy — see "If you want two public domains" below. It is inlined at **build**
  time, so a change needs a new build of this service.

Then **Settings → Networking → Generate Domain**. That domain is the app's URL.
Leave the `api` service without a domain.

### 4. Health checks and what "healthy" means

| Service | Path | Meaning |
| ------- | ---- | ------- |
| `api` | `/api/v1/health` | Liveness: the process answers. Deliberately does not touch the database, so a database blip cannot cause a restart loop. |
| `api` | `/api/v1/health/ready` | Readiness: `SELECT 1` succeeds (`200`, `database: "up"`) or fails (`503`). |
| `web` | `/health` | The static server answers. |

Both API endpoints stay available through the web origin as
`https://<web-domain>/api/v1/health` and `.../health/ready`, so the readiness of
the whole chain can be checked from outside.

### 5. Migration behaviour

- Build: `npm ci --include=dev`, `prisma generate` (the client is git-ignored),
  `tsup` bundle. No database connection is needed.
- Pre-deploy: `prisma migrate deploy` applies every committed migration, in
  order, and skips the ones already recorded in `_prisma_migrations`. It never
  drops or rewrites data.
- Start: `node apps/api/dist/server.js` — the API asserts its production
  configuration, then serves. No seeding, no demo data, no `migrate dev`, no
  `migrate reset`, no `db push`.
- Independent verification used here: 9 migrations applied to an empty database
  produced 13 tables and `database: "up"`
  (`docs/PRODUCTION_TEST_REPORT.md`).

### 6. Smoke test after the first deploy

Run these against the **public web domain**. They use no real account data.

```bash
WEB=https://<web-domain>

# 1. The API is alive and the database is reachable, through the web origin.
curl -fsS "$WEB/api/v1/health" | head -c 200; echo
curl -fsS "$WEB/api/v1/health/ready"; echo          # expect database: "up"

# 2. The SPA is served and a deep client-side route falls back to it.
curl -fsS -o /dev/null -w '%{http_code}\n' "$WEB/"
curl -fsS -o /dev/null -w '%{http_code}\n' "$WEB/transactions"

# 3. Security headers are present.
curl -fsSI "$WEB/" | grep -i -E 'content-security-policy|x-content-type-options|strict-transport-security'

# 4. An unauthenticated API call is refused with a request id.
curl -sS -o /dev/null -w '%{http_code}\n' "$WEB/api/v1/transactions"    # expect 401

# 5. A cross-site write is refused even with a session (CSRF defence).
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$WEB/api/v1/categories" \
  -H 'Origin: https://evil.example' -H 'Content-Type: application/json' \
  -d '{"name":"x","kind":"EXPENSE"}'                                    # expect 403
```

Then in a browser: register an account, import the CSV template
(`/api/v1/imports/template` is also offered in the import wizard), confirm the
dashboard shows the imported rows, sign out, and confirm a protected page returns
you to the sign-in screen. In the Railway log view, confirm the `api` service logs
request ids and no transaction descriptions, merchants, amounts or cookie values.

Finally: once your own account exists, set `ALLOW_REGISTRATION=false` on the
`api` service if this is a private deployment. There is no password-reset email,
so keep a way to sign in before closing registration.

Record the result in `docs/PRODUCTION_TEST_REPORT.md`. Until this table passes,
the deployment is unverified and no claim is made that SpendScope is
production-ready.

### 7. Rollback on Railway

1. Open the service → **Deployments**. Railway keeps previous deployments.
2. On the last known-good deployment for `api`, choose **Redeploy**. Watch the
   healthcheck pass.
3. Redeploy the matching `web` deployment if the bundle changed. `index.html` is
   served `no-store`, so browsers pick up the earlier bundle on the next load.
4. Do **not** roll migrations backwards: a release's migrations are additive for
   one version, so the previous application runs correctly on the new schema.
5. If a release corrupted data, restore the database from a backup **after** the
   application rollback, and record what was lost first: a restore replaces the
   whole database, including anything written after the backup point
   (`docs/DATA_BACKUP_AND_RESTORE.md`).
6. Verify: sign in, load the dashboard, export a CSV, and compare row counts with
   the pre-incident numbers.

### 8. Backups on Railway

Railway's PostgreSQL runs on a volume, and volume contents survive redeploys.
Automated database backups and point-in-time recovery depend on your plan — check
what the dashboard actually offers for the database service, and do not assume
they exist. If they do not, schedule a periodic `pg_dump` to storage outside
Railway, and drill a restore once. The application's own
`/api/v1/exports/backup.json` export is a convenience and a migration path, not a
substitute for database backups.

### 9. If you want two public domains

Giving the `api` service a public domain and setting `VITE_API_URL=https://<api-domain>`
on the `web` service (before it builds) also works, and the code is prepared for
it: CORS allows credentials for allow-listed origins only, `CSP_CONNECT_SRC`
widens the SPA's `connect-src`, and `SESSION_COOKIE_SAME_SITE=none` is available
when the two domains do not share a registrable domain. Two caveats:

- `SameSite=None` requires `Secure` (so HTTPS, which Railway provides) and is a
  weaker CSRF position than the same-origin setup; the origin check on
  state-changing requests is then doing the heavy lifting.
- Browsers increasingly restrict third-party cookies, so prefer two subdomains of
  one domain (`app.example.com` + `api.example.com`) over two unrelated domains.

The single-origin setup in sections 1–3 remains the recommendation: fewer moving
parts, nothing to misconfigure, and the API stays off the public internet.

### 10. Troubleshooting

| Symptom | Cause | Fix |
| ------- | ----- | --- |
| Deploy fails: `PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL` | `prisma generate` ran without `DATABASE_URL` | Add `DATABASE_URL=${{Postgres.DATABASE_URL}}` to the `api` service variables (build-time availability included) |
| Deploy fails: `tsup` / `vite` / `prisma` not found | dev dependencies were pruned for the build | Keep `npm ci --include=dev` in the build command |
| API refuses to start: `production configuration is unsafe` | one of the listed problems: local/`http` `CORS_ORIGIN`, local `DATABASE_URL`, insecure cookie, bootstrap enabled | Fix each bullet in the message; the overrides are only for a deliberate local run |
| App loads, every API call is `404 NO_API_UPSTREAM` | `API_INTERNAL_URL` is unset on `web` | Set it to `http://api.railway.internal:4000` |
| App loads, API calls are `502 BAD_GATEWAY` | the `web` proxy cannot reach the API | Check the `api` service is running and that `PORT` matches the port in `API_INTERNAL_URL` |
| Sign-in appears to succeed, then every request is `401` | the cookie was not stored or not sent | Confirm `SESSION_COOKIE_SECURE=true` with HTTPS, and use one origin (or matching subdomains with `SESSION_COOKIE_SAME_SITE=none`) |
| `prisma migrate deploy` times out pre-deploy | the database URL points at the public TCP proxy from inside the project | Use the private URL (`${{Postgres.DATABASE_URL}}`) |
| Web build served an old bundle | `index.html` caching | It is served `no-store`; hard-refresh, and confirm the deploy actually replaced the `web` deployment |

## Deploying to Vercel (SPA) + Render (API) + Neon (PostgreSQL)

The production split this repository is deployed to: the SPA on **Vercel**,
the API on **Render**, PostgreSQL on **Neon**. All three need settings that only
you can supply from their dashboards.

### What gets deployed

| Service | What it is | Public? |
| ------- | ---------- | ------- |
| Neon | Lakebase PostgreSQL (pooled + direct connection strings) | No — reached only by Render |
| Render | Node service running `apps/api/dist/server.js` | Yes — `https://<api>.onrender.com` |
| Vercel | Static SPA from `apps/web/dist` | Yes — `https://<app>.vercel.app` |

The browser calls the API **cross-site** (Vercel → Render), which drives two
requirements that do not exist in the local or same-origin setups:

1. **CORS** must allow the Vercel origin, with credentials.
2. **The session cookie must be `SameSite=None; Secure`** — a `SameSite=Lax`
   cookie is not sent on cross-site requests, so every API call would answer
   `401` and the app would look broken even though registration succeeded.

### 1. Neon

1. Create a project and a branch (the default branch is fine).
2. From the dashboard → **Connection Details**, copy both strings:
   - **Pooled** connection (hostname contains `-pooler`) → `DATABASE_URL`
   - **Direct** connection (no `-pooler`) → `DATABASE_URL_UNPOOLED`
3. IP allow list: leave open, or restrict to Render's egress IPs if your plan
   supports it.
4. Note: idle compute **scales to zero** (suspends after ~5 minutes). The first
   query after a pause pays a cold-start penalty of a few hundred milliseconds;
   readiness checks get slow, not wrong. Storage stays billed while suspended.
5. Verify what backup/restore history your plan includes.

### 2. Render

Web Service, Node, **root directory = repository root** (npm workspaces need the
root `package.json` and lockfile).

| Setting | Value |
| ------- | ----- |
| Build Command | `npm ci --include=dev && npm run db:generate && npm run build --workspace @spendscope/api` |
| Start Command | `npm run start --workspace @spendscope/api` (Render injects `PORT`) |
| Health Check Path | `/api/v1/health` |

**Variables**:

```
NODE_ENV=production
DATABASE_URL=<Neon pooled URL>
DATABASE_URL_UNPOOLED=<Neon direct URL>
CORS_ORIGIN=https://<your-app>.vercel.app
SESSION_COOKIE_SECURE=true
SESSION_COOKIE_SAME_SITE=none
TRUST_PROXY=1
BOOTSTRAP_DEFAULT_WORKSPACE=false
ALLOW_REGISTRATION=true
LOG_LEVEL=info
```

- `DATABASE_URL_UNPOOLED` is what makes migrations work: Prisma's CLI prefers
  it for `migrate deploy` (wired in `apps/api/prisma.config.ts`), while the
  running application always uses the pooled `DATABASE_URL`. Running migrations
  over the pooled connection fails with misleading errors.
- `CORS_ORIGIN` must be the **exact** Vercel origin. A mismatch means the
  browser blocks every response — this is what "registration does not work"
  looks like from the outside.
- `SESSION_COOKIE_SAME_SITE=none` is required with the default Vercel/Render
  domains. It is only valid together with `Secure` (the API refuses to start
  otherwise). It weakens CSRF defence relative to same-origin, so the origin
  check on state-changing requests is doing the real work — leave it in place.
- Stronger alternative: serve both from one registrable domain
  (`app.example.com` on Vercel, `api.example.com` on Render) and use
  `SESSION_COOKIE_SAME_SITE=lax` instead.
- Leave `ALLOW_LOCAL_DATABASE_IN_PRODUCTION` and `ALLOW_INSECURE_COOKIES` unset.

Deploy once, then confirm the service starts (the production configuration
guard runs first and names any problem).

### 3. Vercel

Import the repository. Keep **Root Directory = repository root** (setting it to
`apps/web` breaks the workspace install).

| Setting | Value |
| ------- | ----- |
| Framework Preset | Vite |
| Build Command | `npm run build --workspace @spendscope/web` |
| Output Directory | `apps/web/dist` |
| Install Command | (default `npm install` is fine) |

**Variables** (build-time — inlined into the bundle, so a change needs a new
deployment):

```
VITE_API_URL=https://<your-api>.onrender.com
```

Only `VITE_*` variables are exposed to the frontend bundle. Never put
`DATABASE_URL`, cookie names, or any other backend variable here.

### 4. Migrations

```bash
DATABASE_URL_UNPOOLED="<Neon direct URL>" npm run db:deploy
```

Applies every committed migration, in order, skipping ones already recorded.
Never `migrate reset`, `db push --force-reset`, or `db:seed` against production.

### 5. Verify before opening the app to users

```bash
API=https://<your-api>.onrender.com
WEB=https://<your-app>.vercel.app

# Liveness and readiness.
curl -fsS "$API/api/v1/health" | head -c 200; echo
curl -fsS "$API/api/v1/health/ready"; echo          # expect database: "up"

# CORS: the Vercel origin is allowed with credentials, a foreign origin is not.
curl -sS -D - -o /dev/null "$API/api/v1/health" \
  -H "Origin: $WEB" | grep -i '^access-control-allow-origin'   # expect the Vercel URL
curl -sS -D - -o /dev/null "$API/api/v1/health" \
  -H "Origin: https://evil.example" | grep -ci '^access-control-allow-origin' || true  # expect 0

# The SPA is served and a deep client-side route falls back to it.
curl -fsS -o /dev/null -w '%{http_code}\n' "$WEB/"
curl -fsS -o /dev/null -w '%{http_code}\n' "$WEB/transactions"

# Security headers on the SPA.
curl -fsSI "$WEB/" | grep -i -E 'content-security-policy|x-content-type-options'
```

Then in a browser: register an account (check the cookie is `Secure;
SameSite=None; HttpOnly`), import the CSV template from the import wizard,
confirm the rows appear on the dashboard, sign out, and confirm a protected page
returns to sign-in. Confirm in Render's logs that request ids appear and no
transaction descriptions, merchants, amounts or cookie values do.

Finally, once your own account exists, set `ALLOW_REGISTRATION=false` on Render
if this is a private deployment. There is no password-reset email, so keep a
way to sign in before closing registration.

Record the result in `docs/PRODUCTION_TEST_REPORT.md`. Until this table passes,
the deployment is unverified and no claim is made that SpendScope is
production-ready.

### 6. Rollback

1. Vercel and Render both keep previous deployments — redeploy the last
   known-good one for each service. `index.html` is served `no-store`, so
   browsers pick up the earlier bundle on the next load.
2. Do **not** roll migrations backwards; releases are additive for one version.
3. If a release corrupted data, restore the Neon branch **after** the
   application rollback, and record what was lost first: a restore replaces the
   whole database.

### 7. Troubleshooting: "Registration is disabled on this installation"

The sign-in footer shows that sentence only when the API answers
`GET /api/v1/auth/config` with `registrationEnabled: false`. A request that
fails or has not answered yet must never be reported as disabled, and the app no
longer does: an unreachable API now reads "Could not reach SpendScope to check
registration." with a retry control. If you still see the *disabled* wording,
the browser did reach the API and the API said no:

```bash
# 1. What the API says, without an Origin header (always allowed).
curl -sS "https://<your-api>.onrender.com/api/v1/auth/config"; echo

# 2. What it says to the browser: the Vercel origin must be echoed back.
curl -sS -D - -o /dev/null "https://<your-api>.onrender.com/api/v1/auth/config" \
  -H "Origin: https://<your-app>.vercel.app" | grep -i access-control-allow-origin
```

- Step 1 returns `"registrationEnabled":true` → the API is fine and
  `ALLOW_REGISTRATION` is in effect.
- Step 2 prints **nothing** → `CORS_ORIGIN` on Render does not contain that exact
  origin. This is the usual cause. The browser cannot read the response, so the
  configuration is unknown to the frontend. Fix `CORS_ORIGIN` (below), not
  `ALLOW_REGISTRATION`.
- Step 2 prints the origin, but the app still reports disabled → the browser is
  calling a *different* API. Check the value compiled into the bundle, because
  `VITE_API_URL` is inlined at build time:

  ```bash
  curl -sS "https://<your-app>.vercel.app/"
  # then fetch the referenced /assets/*.js and grep it for the API host
  ```

  If the bundle has no API host, `VITE_API_URL` was missing when Vercel built the
  SPA and every call went to the Vercel origin, where `/api/v1/...` is not
  served (Vercel returns the SPA HTML, which is not JSON). Set it and redeploy.

`CORS_ORIGIN` accepts a comma-separated list, and a Vercel deployment URL changes
on every deployment, so list the stable production alias as well:

```
CORS_ORIGIN=https://<your-app>.vercel.app,https://<project>-git-main-<team>.vercel.app
```

Add a custom domain (for example `app.example.com`) and use it as the single
entry — it survives deployments and makes the `SameSite` decision easier. After
changing Render variables the service restarts; the production guard runs first
and will refuse to start with the offending variable named if the value is
malformed.

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
| `SESSION_COOKIE_SAME_SITE` | `lax` | Keep `lax` on one origin or matching subdomains; `none` only for a frontend on a different registrable domain (requires `Secure`, weakens CSRF defence) |
| `SESSION_TTL_HOURS` | `720` (30 days) or lower | Shorter means more re-sign-ins |
| `TRUST_PROXY` | `1` behind one proxy/load balancer | Must match reality or rate limiting sees the proxy's IP |
| `LOG_LEVEL` | `info` | `warn` in noisy environments |
| `BOOTSTRAP_DEFAULT_WORKSPACE` | `false` | `true` would create an unowned workspace on start |
| `ALLOW_REGISTRATION` | `true`, or `false` once your account exists | Closing it is the simplest way to keep a personal deployment private |
| `ALLOW_LOCAL_DATABASE_IN_PRODUCTION` | unset | Setting it acknowledges a non-production run |
| `ALLOW_INSECURE_COOKIES` | unset | Same |
| `MAX_UPLOAD_BYTES` | `5242880` | Must stay below the proxy's `client_max_body_size` |
| `VITE_API_URL` | unset | Same-origin: the SPA calls `/api/v1` on its own origin and the web server proxies it. Set it only for the two-public-domains setup, and remember it is inlined at build time |
| `API_INTERNAL_URL` (web service) | `http://api.railway.internal:4000` | Upstream for the `/api` proxy; see [Deploying to Railway](#deploying-to-railway-step-by-step) |
| `HOST` | unset | Unset binds every interface, which is what every PaaS expects |

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

Without Docker (a platform that runs the commands directly, such as Railway):

```bash
# Build (both services build from the repository root because of the workspace)
npm ci --include=dev
npm run db:generate                                  # Prisma client (git-ignored)
npm run build --workspace @spendscope/api            # tsup → apps/api/dist/server.js
npm run build --workspace @spendscope/web            # tsc --noEmit + vite → apps/web/dist

# Run
npm run start                                        # API  (node apps/api/dist/server.js)
npm run start:web                                    # web  (node apps/web/server.mjs)

# Migrate, once per release, before the new API version starts
npm run db:deploy                                    # prisma migrate deploy
```

`apps/web/server.mjs` is the production web server: it serves `apps/web/dist`
with the same security headers as `apps/web/nginx.conf`, adds SPA fallback and
cache control, exposes `/health`, and — when `API_INTERNAL_URL` is set — proxies
`/api/*` to the API so the browser sees a single origin. Step-by-step Railway
settings are in [Deploying to Railway](#deploying-to-railway-step-by-step).

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
   your approval. Railway is the initial target; the step-by-step guide in
   [Deploying to Railway](#deploying-to-railway-step-by-step) lists every
   service, build command, start command, variable and smoke test.
2. **Provide `DATABASE_URL`** for the production database through the platform's
   secret store, plus `CORS_ORIGIN` for the real hostname, `TRUST_PROXY` for the
   real proxy count, and `API_INTERNAL_URL` on the web service. On Railway the
   Postgres plugin reference variable `${{Postgres.DATABASE_URL}}` supplies the
   private connection string; no credentials need to be copied by hand.
3. **Register the domain** (optional — a Railway-generated domain works) and point
   it at the platform's load balancer, then enable managed TLS. This is the step
   that cannot be done or verified from here.
4. **Run the first deployment and its pre-deploy migration** — on Railway this is
   the `api` service's Pre-Deploy Command (`npm run db:deploy`) — and confirm
   `GET /api/v1/health/ready` returns `database: "up"`.
5. **Run the production smoke test** from `PRODUCTION_READINESS.md` §15 and
   section 6 of [Deploying to Railway](#deploying-to-railway-step-by-step) against
   the public URLs with a test account, and record the result in
   `docs/PRODUCTION_TEST_REPORT.md`. Until this is done, the deployment is
   unverified, and no claim is made that SpendScope is production-ready.
