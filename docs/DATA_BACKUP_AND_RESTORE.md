# Data backup and restore

SpendScope holds a person's complete financial history. Two independent layers
protect it, and only the first one is a real backup:

| Layer | Protects against | Is it a backup? |
| ----- | ---------------- | --------------- |
| **Database backups** — the managed database's automated snapshots and point-in-time recovery, or `pg_dump` on a self-hosted host | Host failure, corruption, an accidental `DELETE`, a bad migration | **Yes.** This is the recovery mechanism. |
| **Application export** — `GET /api/v1/exports/backup.json` and `restore` | Losing one workspace's data, moving it to another installation, a user's own mistake | No. It is a user-facing export and migration path. |

Never treat the application export as a backup: it is produced on demand, it lives
wherever the user saved it, and restoring it is a deliberate, workspace-scoped
operation.

## Database backups

### Managed PostgreSQL (recommended)

1. Enable **automated backups** with **point-in-time recovery** on the database
   instance. This is the primary control.
2. **Retention:** 7 days minimum, 30 days for a real financial history. A
   statement's dispute window is usually 60–120 days, so a longer retention is
   worth the storage cost if it is available.
3. **Encryption:** enable storage encryption (on by default with most managed
   services) and require TLS on connections (`sslmode=require` in
   `DATABASE_URL`).
4. **Access control:** only the API's database role may connect. That role needs
   `SELECT`, `INSERT`, `UPDATE`, `DELETE` on the application tables plus DDL for
   migrations — not superuser, not `CREATEDB`, and no access to other databases
   on the instance.
5. **Where backups live:** in the provider's own storage, in the same region as
   the instance. If a copy in a second region is affordable, take it.

### Self-hosted PostgreSQL

Take a nightly logical dump and keep it off the host:

```bash
# Logical, compressed, off-host. Run nightly from cron or a systemd timer.
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges \
  | gzip > "/backups/spendscope-$STAMP.dump.gz"

# Keep 30 days locally, and mirror to object storage.
find /backups -name 'spendscope-*.dump.gz' -mtime +30 -delete
```

For a consistent physical backup of a busy instance, use `pg_basebackup` with
write-ahead log archiving so point-in-time recovery is possible.

### What is stored in a backup

Everything: `User` (email, name, scrypt password hash), `Session` (token
**hashes** only), and every workspace's transactions, categories, budgets, rules,
import batches and import previews. A backup therefore contains personal
financial data. Store it somewhere with the same access control as the database
itself, and delete expired copies rather than leaving them inadvertently.

## Restore

### Drill (verified — see the result below)

Restoring into a **scratch** database first is the only way to know a backup
works. It never touches the live database.

```bash
# 1. A throwaway database, not the production one.
createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" spendscope_restore_drill

# 2. Restore the dump into it.
pg_restore -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" \
  --dbname spendscope_restore_drill --no-owner --no-privileges backup.dump

# 3. Compare against the source: table list, row counts, applied migrations.
psql ... -tAc "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1"
psql ... -tAc 'SELECT (SELECT count(*) FROM "Transaction"), (SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL)'
```

Then point the API at the restored copy and confirm the application agrees:

```bash
DATABASE_URL=postgresql://.../spendscope_restore_drill \
  PORT=4100 NODE_ENV=production ... node apps/api/dist/server.js
curl -fsS http://127.0.0.1:4100/api/v1/health/ready
```

### Drill result (recorded)

Performed on 2026-10-17 against the local PostgreSQL 18 cluster, on port 5433,
with a custom-format `pg_dump` of the development database:

| Step | Command | Result |
| ---- | ------- | ------ |
| Create scratch database | `psql -c 'CREATE DATABASE spendscope_restore_drill'` | `CREATE DATABASE` |
| Dump | `pg_dump ... -Fc -f spendscope.dump` | 37 KB dump written |
| Restore | `pg_restore ... --no-owner --no-privileges` | no errors |
| Row counts (source → restored) | `Transaction 0 → 0`, `Category 17 → 17`, `User 1 → 1`, `Workspace 1 → 1`, `_prisma_migrations (finished) 9 → 9` | identical |
| Schema parity | `SELECT tablename FROM pg_tables WHERE schemaname='public'` | identical, 13 tables |
| Application boot | `node dist/server.js` against the restored copy, `NODE_ENV=production` | `GET /api/v1/health/ready` → `{"status":"ready","database":"up"}` |
| Scratch database removed | `DROP DATABASE spendscope_restore_drill` | dropped |

The development database held no transactions at the time, so the row-count
comparison proves the *structure* restore but not a large-data restore. The
50,000-row load test in `docs/PRODUCTION_TEST_REPORT.md` covers volume
separately. **Repeat this drill against a copy of the production database before
relying on a production backup.**

### Recovery into production

1. Stop the API (or take it out of the load balancer) so nothing writes during
   the restore.
2. Prefer the managed service's point-in-time recovery: it restores to a new
   instance, which you can inspect before switching traffic.
3. For a logical dump, restore into a fresh database and repoint `DATABASE_URL`
   at it, rather than restoring over the live one:

   ```bash
   createdb spendscope_recovered
   pg_restore --dbname spendscope_recovered --no-owner --no-privileges backup.dump
   npx prisma migrate deploy            # confirm schema is current
   # then: update DATABASE_URL and start the API
   ```

4. Confirm recovery: `GET /api/v1/health/ready`, then sign in, load the
   dashboard, and compare the transaction count and one period's totals against
   the numbers you recorded before the incident.
5. Record what was lost. A restore to a backup point discards everything written
   after that point; there is no partial recovery from a logical dump.

### Recovery objectives

Targets, not measurements — they depend on the platform you choose:

| Objective | Target | Depends on |
| --------- | ------ | ---------- |
| **RPO** (maximum data loss) | ≤ 5 minutes | Point-in-time recovery enabled on the managed instance. A nightly logical dump alone gives an RPO of up to 24 hours. |
| **RTO** (time to restore service) | ≤ 1 hour | Provisioning a recovery instance plus the time to restore and verify. A dump of a few hundred MB restores in minutes. |

State the real numbers once the platform is chosen and the drill is repeated
against production-sized data.

## What not to do

- Do not test recovery against the production database. Restore into a scratch
  or recovered database.
- Do not run `prisma migrate reset`, `db push --force-reset` or `npm run db:seed`
  against production. The first two destroy all data; the third inserts demo rows
  that a real workspace must never contain.
- Do not edit an already-applied migration. Prisma checksums it and the next
  `migrate deploy` will refuse to proceed.
- Do not commit a dump, or store it in the repository. It contains personal
  financial data and password hashes.
- Do not overwrite the only good backup. Keep at least two restore points, and
  verify a restore before deleting an older one.

## Application-level export and restore

- `GET /api/v1/exports/backup.json` returns a portable document for the
  signed-in workspace: settings, categories (referenced by **name and kind**, so
  the document survives a different installation's ids), transactions, budgets,
  category rules and import batch summaries. It contains no session or password
  data.
- `POST /api/v1/exports/restore` requires `mode` (`replace` or `merge`) and the
  literal `confirm: "RESTORE"`. It is transactional and scoped to the caller's
  own workspace, so it can never write into another user's data. A `replace`
  restore deletes that workspace's rows first.
- `GET /api/v1/exports/transactions.csv` exports a filtered transaction list for
  use in a spreadsheet, capped at 50,000 rows with `X-Total-Truncated: true` when
  a larger set is cut short. Cells that would be interpreted as a formula are
  prefixed with an apostrophe.
