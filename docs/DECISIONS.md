# Design decisions

Notable decisions and the trade-offs behind them. Format: **Decision**,
**Why**, **Consequence**.

## Money and data integrity

### Positive magnitude + explicit type

**Decision.** Amounts are stored as a positive magnitude in `DECIMAL(14,2)`
together with an explicit `type` (`INCOME`/`EXPENSE`/`TRANSFER`/`REFUND`).

**Why.** A signed amount cannot express a refund of an expense without the
reader knowing whether the sign. A dedicated type makes the direction explicit
and lets `TRANSFER` be excluded from totals by rule rather than by heuristics.

**Consequence.** Every aggregate filters or groups by `type`. Import maps a
sign onto a type once, at parse time.

### Decimal strings on the wire, integer minor units in arithmetic

**Decision.** Amounts are serialised as strings (`"1234.50"`) and computed in
`BigInt` minor units (`packages/shared/src/money.ts`); the API computes with
Prisma `Decimal`.

**Why.** JavaScript numbers are IEEE-754 doubles; `0.1 + 0.2 !== 0.3`. Money
must not round-trip through floats.

**Consequence.** A few call sites convert to `Number` for percentages and for
chart libraries. Those conversions happen only after the exact total is known.

### Money stored in PostgreSQL, not in the client

**Decision.** The database holds the source of truth; `DECIMAL` columns with
`SUM`/`GROUP BY` do the aggregation.

**Why.** A local-first app still deserves a real database. Period totals are
computed with SQL aggregates
(`apps/api/src/lib/aggregates.ts`) rather than by loading every row into memory.

**Consequence.** Two raw-SQL (`$queryRaw`) helpers are used for the
month/day series because Prisma's `groupBy` cannot `date_trunc`. They are
parameterised with tagged templates.

## Tenancy and schema

### `workspaceId` on every row now, authentication later

**Decision.** Every user-owned table carries `workspaceId`; services scope every
query by it. The MVP seeds exactly one workspace and there is no auth.

**Why.** Retrofitting a tenant column and scoping into a finished codebase is a
large, risky change. Adding it up front costs almost nothing.

**Consequence.** There is currently **no authentication** and the API must never
be exposed to a network ([SECURITY.md](SECURITY.md)). Adding auth means binding
the workspace to the authenticated principal, not rewriting the services.

### Partial unique index for the total budget

**Decision.** "One total monthly expense budget" is enforced by a partial unique
index (`… WHERE "categoryId" IS NULL`), added in
`20261016234000_budget_total_unique`.

**Why.** PostgreSQL treats `NULL`s as distinct in a unique constraint, so the
generated `UNIQUE (workspaceId, month, categoryId)` would happily allow two rows
with `categoryId = NULL`.

**Consequence.** The invariant is a database constraint, not an application
convention, so the concurrent-write race is closed. Prisma's schema cannot
express it, so the index lives in a hand-written migration — documented in
[DATA_MODEL.md](DATA_MODEL.md#budget).

### `Settings` is a single row (`id = 1`)

**Decision.** Application settings live in one row keyed by `id = 1`, with a
unique `workspaceId`.

**Why.** There is exactly one settings object per workspace. A key/value table
would add indirection for no benefit.

**Consequence.** The `PreferencesCard` in the web app is keyed by
`settings.updatedAt` so a server refresh remounts it and resets local form
state — the effect-free alternative to syncing props into state.

## Duplicate detection

### SHA-256 fingerprint + separate "possible duplicate" pass

**Decision.** Exact duplicates are SHA-256 hashes of
`date|normalised description|amount|type|normalised merchant`. Same date and
amount with different wording is a *possible* duplicate, flagged but not
skipped.

**Why.** Normalisation catches re-exports of the same statement (spacing,
punctuation, diacritics, case). It deliberately does **not** catch two identical
legitimate purchases; those must not be silently merged. Reworded duplicates
can't be identified with certainty, so the user decides.

**Consequence.** The possible-duplicate scan is capped at 20,000 rows in the
affected date range; when the cap is hit the preview carries an explicit
warning instead of silently missing matches.

## Imports

### Preview is stored server-side and is single-use

**Decision.** `POST /api/v1/imports/preview` parses the file, validates every
row, and stores the parsed records in an in-memory preview store
(`ImportPreviewStore`, TTL 30 minutes, max 25 previews). `POST /api/v1/imports`
re-validates from the stored records. Previewing consumes the preview.

**Why.** The browser must not be trusted to submit "already validated" row data —
that would be a way to bypass validation. Re-validating server-side from the
stored parse keeps one validation path.

**Consequence.** Previews do not survive an API restart, and only the first 200
rows are returned to the browser (of a maximum 20,000). The counter shown to the
user is computed from the full set, and commit processes every stored valid row,
not just the displayed ones.

### `rowIndex` is 0-based over data rows

**Decision.** `rowIndex` counts data rows only (header excluded), starting at 0.
The file line number is therefore `rowIndex + 2`.

**Why.** One stable, documented index makes error messages reproducible
regardless of quoting, blank lines or the header.

**Consequence.** UI copy says "row N" and the docs state the mapping.

### Ambiguous dates parse **day-first**

**Decision.** `01/02/2026` is read as 1 February 2026.

**Why.** The default locale/currency is Ghanaian (`en-GH`, `GHS`), where
day-first is the convention. Guessing per-row would be non-deterministic.

**Consequence.** US-format exports with ambiguous dates import wrongly unless the
date is unambiguous (`12/25/2026` is parsed correctly). Documented in the README
and [FINANCIAL_RULES.md](FINANCIAL_RULES.md#accepted-dates).

## API shape

### Express 5 with validated locals

**Decision.** Zod schemas from `@spendscope/shared` validate input; validated
values are stored in `res.locals` and read through `queryOf`/`paramsOf` helpers.

**Why.** In Express 5 `req.query` is a getter-only property, so the common
"reassign `req.query` with parsed values" pattern throws.

**Consequence.** Handlers call `queryOf(res)` instead of touching `req.query`
directly. One consistent accessor.

### Uniform error envelope

**Decision.** Errors are `{ error: { code, message, details? } }`. Success
responses are the DTO itself, or `{ data }` for lists.

**Why.** The web client has one error path and one message extractor.

**Consequence.** HTTP status carries the class (400/404/409/500); `code` carries
the machine-readable reason.

## Frontend

### Prisma client generated into source, git-ignored

**Decision.** The Prisma 7 client is generated to
`apps/api/src/generated/prisma` with `importFileExtension = "ts"` and a
`prisma.config.ts` at `apps/api/`.

**Why.** Prisma 7's `prisma-client` generator emits TypeScript (not a runtime
package), and the project is ESM with explicit `.ts` extensions in the API.

**Consequence.** `npm run db:generate` must run once after cloning, before
type-checking the API. The generated folder is git-ignored.

### `packages/shared` ships TypeScript source

**Decision.** `@spendscope/shared` exports `.ts` source directly; consumers
compile it (Vite for web, tsx for API dev, tsup for the API build).

**Why.** No build step to keep in sync, and types are always exact. The Zod
schemas, DTO types and money/date helpers are the single source of truth shared
by both apps.

**Consequence.** The API build (tsup) must bundle the shared source and mark
runtime deps (`pg`, `pino`, `pino-pretty`) as external.

### Native `<select>` instead of Radix Select

**Decision.** Form selects use the native `<select>` element; the project uses
Lucide, Recharts and a small set of Radix primitives (dialog, dropdown) but not
`@radix-ui/react-select`.

**Why.** A native select is keyboard- and screen-reader-correct for free, works
in tests without portal workarounds, and removes a dependency.

**Consequence.** Styling is done with Tailwind on the native control; there is
no custom listbox to maintain.

### Route-level code splitting

**Decision.** Route pages are loaded with `React.lazy` and wrapped in a single
`Suspense` boundary in `AppShell` (falling back to `LoadingState`).

**Why.** Recharts is heavy; shipping it in the entry chunk would slow first
paint. Splitting keeps every chunk under the 500 KB warning threshold.

**Consequence.** A short loading state appears on first navigation to a route.

### Theme applied before first paint

**Decision.** A small inline script in `index.html` reads `localStorage`
(`spendscope-theme`) and sets the theme class before the app renders; the choice
is mirrored to the server setting.

**Why.** Reading the theme in React causes a flash of the wrong theme.

**Consequence.** Theme lives in two places (local storage for pre-paint, the
settings row for durability) and the settings endpoint keeps them consistent.

### Dialog state without effects

**Decision.** Dialog reset uses conditional mounts and derived state instead of
`useEffect` + `setState` (the mobile drawer derives its open state from
`mobileOpenPath === location.pathname`; `CategoryDeleteDialog` mounts only when
`pendingDelete !== null`; `PreferencesCard` is keyed by `settings.updatedAt`).

**Why.** The lint rule `react-hooks/set-state-in-effect` flags the sync-props-
to-state pattern, and it is genuinely a source of flicker and stale state.

**Consequence.** Components remount to reset rather than resetting in place;
this is cheap here and removes a class of bugs.

## Tooling

### Committed migrations, `db:deploy` for application

**Decision.** Migrations are committed SQL; normal setup uses `npm run db:deploy`
(not `migrate dev`).

**Why.** `migrate dev` may generate new migrations and prompts interactively —
wrong for a reproducible setup or CI. `deploy` applies exactly what is committed.

**Consequence.** `db:migrate` is reserved for schema changes during development.
Prisma 7 no longer auto-runs `generate`/`seed` after a migration, so those are
explicit scripts.

### Test database is separate and wiped between runs

**Decision.** Integration tests use `TEST_DATABASE_URL`, a distinct database,
truncated between runs.

**Why.** Tests must never delete real data, and a wiped database makes them
order-independent.

**Consequence.** Running the API tests requires the local Postgres to be up
([LOCAL_POSTGRES.md](LOCAL_POSTGRES.md)).
