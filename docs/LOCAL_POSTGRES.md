# Local PostgreSQL for SpendScope

SpendScope is developed and tested against a **private PostgreSQL cluster** that
lives entirely inside your home directory. Nothing is installed as a system
service, nothing listens on the network, and no password is stored anywhere.

Why a dedicated cluster instead of a shared system Postgres:

- the data directory sits at `~/.spendscope/pgdata`, so deleting that one folder
  removes every trace of the app's data;
- it runs on **port 5433**, so it never collides with a system Postgres on 5432;
- it uses **trust authentication over the loopback interface only**, so it is
  reachable by your user and nothing else.

> **Security.** Trust auth means any local process can connect as `postgres`.
> That is acceptable because the cluster only listens on `localhost` and holds
> only local development data. Never reuse this configuration on a machine you
> do not control. See [SECURITY.md](SECURITY.md).

## Prerequisites

- PostgreSQL **18** (the binaries are used directly; no `brew services` needed).
  The examples below use the EDB installer path
  `/Library/PostgreSQL/18/bin`. Substitute your own `pg_ctl`/`initdb` path if
  you installed Postgres differently.
- Node.js ≥ 20.19.

## 1. Initialise the cluster (once)

```bash
export PATH="/Library/PostgreSQL/18/bin:$PATH"
mkdir -p "$HOME/.spendscope"

initdb -D "$HOME/.spendscope/pgdata" -U postgres --auth-local=trust --auth-host=trust
```

`-U postgres` creates a superuser named `postgres` with no password. Trust auth
is applied to both local (socket) and host (TCP) connections.

## 2. Start and stop

```bash
# start: port 5433, socket in /tmp, log inside ~/.spendscope
pg_ctl -D "$HOME/.spendscope/pgdata" \
  -o "-p 5433 -k /tmp" \
  -l "$HOME/.spendscope/pg.log" start

# stop
pg_ctl -D "$HOME/.spendscope/pgdata" stop
```

`pg.log` is the server log — read it first when a migration or the API cannot
connect.

## 3. Create the databases

```bash
createdb -h localhost -p 5433 -U postgres spendscope
createdb -h localhost -p 5433 -U postgres spendscope_test
```

- `spendscope` — development database (safe to reset; `npm run db:reset` drops
  and recreates it).
- `spendscope_test` — the database the automated API integration tests use. It
  is **wiped between test runs**. Never point it at data you care about.

`prisma migrate dev` can create its own temporary shadow database. If your
Postgres role cannot create databases, set `SHADOW_DATABASE_URL` in `.env`
instead (a third database, e.g. `spendscope_shadow`).

## 4. Point the app at it

Copy `.env.example` to `.env` at the repository root. The defaults already match
this cluster:

```dotenv
DATABASE_URL="postgresql://postgres@localhost:5433/spendscope?schema=public"
TEST_DATABASE_URL="postgresql://postgres@localhost:5433/spendscope_test?schema=public"
```

`.env` is git-ignored. The backend loads exactly one `.env`, resolved from the
repository root, so the same file works for the API, Prisma CLI, tests and the
Playwright run.

## 5. Apply migrations and seed

```bash
npm run db:deploy        # apply the committed migrations
npm run db:seed          # default workspace + categories + sample data
```

`npm run db:deploy` is the production-shaped path: it applies the SQL already
committed under `apps/api/prisma/migrations` and never edits the schema. Use
`npm run db:migrate` only when you are changing the schema and need Prisma to
write a new migration.

## Useful commands

| Command                                          | Purpose                                   |
| ------------------------------------------------ | ----------------------------------------- |
| `psql -h localhost -p 5433 -U postgres -d spendscope` | Open a SQL shell                     |
| `pg_ctl -D "$HOME/.spendscope/pgdata" status`     | Is the cluster running?                   |
| `tail -f "$HOME/.spendscope/pg.log"`              | Follow the server log                     |
| `npm run db:studio`                               | Browse tables with Prisma Studio          |
| `npm run db:reset`                                | Drop, recreate and re-migrate `spendscope` |

## Verification

```bash
pg_ctl -D "$HOME/.spendscope/pgdata" status
psql -h localhost -p 5433 -U postgres -d spendscope -c '\dt'
```

You should see the Prisma tables (`Workspace`, `Category`, `Transaction`,
`Budget`, `ImportBatch`, `Settings`, `_prisma_migrations`).

If the API exits with `failed to bootstrap workspace` in the log, the database
is either not running or not migrated — check `pg_ctl status` first, then
`npm run db:deploy`.

## Alternative: any PostgreSQL ≥ 14

Nothing about SpendScope depends on the private cluster. Any reachable Postgres
works as long as you set `DATABASE_URL` and `TEST_DATABASE_URL` (and run
`npm run db:deploy`). The money columns are plain `DECIMAL(14,2)`, so no
extension is required.
