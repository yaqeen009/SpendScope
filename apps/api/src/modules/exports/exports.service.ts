import type { ExportQuery, RestoreBackupInput } from '@spendscope/shared';
import { BACKUP_FORMAT, BACKUP_VERSION } from '@spendscope/shared';

import { dateOnlyRangeFilter } from '../../lib/dates.ts';
import { baseCurrency, displayCurrency } from '../../lib/currency.ts';
import { normalizePattern } from '../../lib/category-rules.ts';
import { normalizeMerchant } from '../../lib/fingerprint.ts';
import { dateOnlyToUtcDate, utcDateToDateOnly } from '../../lib/dates.ts';
import { BadRequestError } from '../../lib/errors.ts';
import { assertSupportedCurrency } from '../../lib/currency.ts';
import { buildFingerprint } from '../../lib/fingerprint.ts';
import { prisma } from '../../lib/prisma.ts';
import type { Prisma } from '../../lib/prisma.ts';
import { toCsv } from '../../lib/csv.ts';

/**
 * Data export and workspace backup/restore.
 *
 * Two guarantees matter here:
 *
 *  1. **CSV injection.** A cell that starts with `=`, `+`, `-`, `@`, TAB or CR
 *     is prefixed with a single quote so a spreadsheet treats it as text. Values
 *     are never evaluated by SpendScope either — this guards the *reader*.
 *  2. **Restore safety.** A restore only ever touches the authenticated
 *     workspace. `replace` clears that workspace (never any other), `merge` adds
 *     to it, and both are inside a single database transaction.
 */

/** Hard cap on exported rows so one request cannot exhaust memory. */
export const MAX_EXPORT_ROWS = 50_000;

const CSV_COLUMNS = [
  'date',
  'description',
  'merchant',
  'amount',
  'currency',
  'type',
  'category',
  'notes',
  'review_status',
  'import_batch_id',
  'refund_of_id',
  'transfer_group_id',
  'created_at',
] as const;

const FORMULA_LEAD = /^[=+\-@\t\r]/;

/** Neutralises spreadsheet formula injection without changing the stored data. */
export function csvCell(value: string): string {
  return FORMULA_LEAD.test(value) ? `'${value}` : value;
}

export function buildWhere(workspaceId: string, query: ExportQuery): Prisma.TransactionWhereInput {
  const where: Prisma.TransactionWhereInput = { workspaceId };

  if (query.from || query.to) {
    where.transactionDate = dateOnlyRangeFilter(query.from, query.to);
  }
  if (query.search) {
    where.OR = [
      { description: { contains: query.search, mode: 'insensitive' } },
      { merchant: { contains: query.search, mode: 'insensitive' } },
      { notes: { contains: query.search, mode: 'insensitive' } },
    ];
  }
  if (query.categoryId === 'uncategorized') {
    where.categoryId = null;
  } else if (query.categoryId) {
    where.categoryId = query.categoryId;
  }
  if (query.type && query.type.length > 0) {
    where.type = { in: query.type };
  }
  if (query.reviewStatus) where.reviewStatus = query.reviewStatus;
  if (query.importBatchId) where.importBatchId = query.importBatchId;
  if (query.minAmount || query.maxAmount) {
    where.amount = {
      ...(query.minAmount ? { gte: query.minAmount } : {}),
      ...(query.maxAmount ? { lte: query.maxAmount } : {}),
    };
  }
  return where;
}

/** Renders the filtered transactions as CSV, ready to download. */
export async function buildTransactionsCsv(
  workspaceId: string,
  query: ExportQuery,
): Promise<{ filename: string; csv: string; rows: number; truncated: boolean }> {
  const where = buildWhere(workspaceId, query);

  // The exported code is the *resolved* one, so a base-currency row is labelled
  // with the workspace's actual currency rather than an empty cell a reader
  // would have to interpret.
  const base = await baseCurrency(workspaceId);

  const total = await prisma.transaction.count({ where });
  const rows = await prisma.transaction.findMany({
    where,
    include: { category: { select: { name: true } } },
    orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
    take: MAX_EXPORT_ROWS,
  });

  const body = rows.map((row) => [
    utcDateToDateOnly(row.transactionDate),
    csvCell(row.description),
    csvCell(row.merchant ?? ''),
    row.amount.toFixed(2),
    displayCurrency(row.currency ?? null, base),
    row.type,
    csvCell(row.category?.name ?? ''),
    csvCell(row.notes ?? ''),
    row.reviewStatus,
    row.importBatchId ?? '',
    row.refundOfTransactionId ?? '',
    row.transferGroupId ?? '',
    row.createdAt.toISOString(),
  ]);

  return {
    filename: `spendscope-transactions-${new Date().toISOString().slice(0, 10)}.csv`,
    csv: toCsv([[...CSV_COLUMNS], ...body]),
    rows: rows.length,
    truncated: total > rows.length,
  };
}

/** A complete, versioned, restorable snapshot of one workspace. */
export async function buildBackup(workspaceId: string): Promise<Record<string, unknown>> {
  const [workspace, settings, categories, transactions, budgets, importBatches, categoryRules] =
    await Promise.all([
      prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { name: true } }),
      prisma.settings.findUnique({ where: { workspaceId } }),
      prisma.category.findMany({ where: { workspaceId }, orderBy: { name: 'asc' } }),
      prisma.transaction.findMany({
        where: { workspaceId },
        include: { category: { select: { name: true, kind: true } } },
        orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }],
      }),
      prisma.budget.findMany({
        where: { workspaceId },
        include: { category: { select: { name: true, kind: true } } },
        orderBy: { month: 'asc' },
      }),
      prisma.importBatch.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' } }),
      prisma.categoryRule.findMany({
        where: { workspaceId },
        include: { category: { select: { name: true, kind: true } } },
        orderBy: { priority: 'asc' },
      }),
    ]);

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    workspace: { name: workspace.name },
    settings: settings
      ? {
          currency: settings.currency,
          locale: settings.locale,
          theme: settings.theme,
          defaultPeriod: settings.defaultPeriod,
        }
      : null,
    categories: categories.map((category) => ({
      name: category.name,
      kind: category.kind,
      color: category.color,
      description: category.description,
      isDefault: category.isDefault,
    })),
    // `ref` values are local to the document.
    importBatches: importBatches.map((batch) => ({
      ref: batch.id,
      filename: batch.filename,
      status: batch.status,
      totalRows: batch.totalRows,
      createdRows: batch.createdRows,
      duplicateRows: batch.duplicateRows,
      invalidRows: batch.invalidRows,
      skippedRows: batch.skippedRows,
      notes: batch.notes,
    })),
    categoryRules: categoryRules.map((rule) => ({
      matchField: rule.matchField,
      pattern: rule.pattern,
      categoryName: rule.category.name,
      categoryKind: rule.category.kind,
      priority: rule.priority,
      isActive: rule.isActive,
    })),
    transactions: transactions.map((row) => ({
      id: row.id,
      transactionDate: utcDateToDateOnly(row.transactionDate),
      description: row.description,
      merchant: row.merchant,
      amount: row.amount.toFixed(2),
      type: row.type,
      categoryName: row.category?.name ?? null,
      categoryKind: row.category?.kind ?? null,
      notes: row.notes,
      reviewStatus: row.reviewStatus,
      refundOfId: row.refundOfTransactionId,
      transferGroupId: row.transferGroupId,
      importBatchRef: row.importBatchId,
      currency: row.currency,
    })),
    budgets: budgets.map((budget) => ({
      month: utcDateToDateOnly(budget.month).slice(0, 7),
      amount: budget.amount.toFixed(2),
      categoryName: budget.category?.name ?? null,
      categoryKind: budget.category?.kind ?? null,
    })),
  };
}

export interface RestoreResult {
  mode: 'replace' | 'merge';
  transactions: number;
  categories: number;
  budgets: number;
  importBatches: number;
  categoryRules: number;
  /** Rows dropped because they referenced a category missing from the backup. */
  uncategorisedByMissingCategory: number;
}

function categoryKey(name: string, kind: string): string {
  return `${name.toLowerCase()}|${kind}`;
}

/**
 * Bounds for the restore transaction.
 *
 * Restore runs as a single interactive transaction, so the whole document must
 * fit inside Prisma's default 5-second window. A backup carrying refund links is
 * written row by row — `createMany` cannot return the ids those links need — so a
 * large document is hundreds or thousands of round trips. On a loaded database
 * the default expires part-way through and the entire restore fails with "a
 * query cannot be executed on an expired transaction", which the user sees as a
 * plain 500. The timeout is raised for that shape of work, and `maxWait` with it
 * so acquiring the connection on a busy pool is not itself the failure.
 */
const RESTORE_TRANSACTION_OPTIONS = { timeout: 30_000, maxWait: 15_000 } as const;

/**
 * Restores a backup document into the given workspace.
 *
 * The document is already validated by the request schema. Restoring is
 * workspace-scoped and transactional: a failure leaves the workspace untouched.
 */
export async function restoreBackup(
  workspaceId: string,
  input: RestoreBackupInput,
): Promise<RestoreResult> {
  const backup = input.backup;
  const replace = input.mode === 'replace';

  // Duplicate category names are impossible in a workspace (unique index), so
  // reject a document that would need two rows with the same name.
  const seenNames = new Set<string>();
  for (const category of backup.categories) {
    const key = category.name.toLowerCase();
    if (seenNames.has(key)) {
      throw new BadRequestError(`The backup lists the category "${category.name}" more than once`);
    }
    seenNames.add(key);
  }

  return prisma.$transaction(async (tx) => {
    if (replace) {
      // Only this workspace. Order matters: children before parents.
      await tx.transaction.deleteMany({ where: { workspaceId } });
      await tx.budget.deleteMany({ where: { workspaceId } });
      await tx.importBatch.deleteMany({ where: { workspaceId } });
      await tx.categoryRule.deleteMany({ where: { workspaceId } });
      await tx.category.deleteMany({ where: { workspaceId } });
    }

    // Categories, keyed by name + kind.
    const categoryIdByKey = new Map<string, string>();
    const nameToId = new Map<string, string>();

    const existing = await tx.category.findMany({
      where: { workspaceId },
      select: { id: true, name: true, kind: true },
    });
    for (const category of existing) {
      categoryIdByKey.set(categoryKey(category.name, category.kind), category.id);
      nameToId.set(category.name.toLowerCase(), category.id);
    }

    let categoriesCreated = 0;
    for (const category of backup.categories) {
      const key = categoryKey(category.name, category.kind);
      if (categoryIdByKey.has(key)) continue;
      const created = await tx.category.create({
        data: {
          workspaceId,
          name: category.name,
          kind: category.kind,
          color: category.color ?? null,
          description: category.description ?? null,
          isDefault: category.isDefault ?? false,
        },
        select: { id: true },
      });
      categoryIdByKey.set(key, created.id);
      nameToId.set(category.name.toLowerCase(), created.id);
      categoriesCreated += 1;
    }

    const resolveCategory = (name: string | null | undefined, kind: string | null | undefined): string | null => {
      if (!name) return null;
      if (kind) {
        const byKey = categoryIdByKey.get(categoryKey(name, kind));
        if (byKey) return byKey;
      }
      return nameToId.get(name.toLowerCase()) ?? null;
    };

    // Import batches, keyed by the document-local ref.
    const batchIdByRef = new Map<string, string>();
    let batchesCreated = 0;
    for (const batch of backup.importBatches ?? []) {
      const created = await tx.importBatch.create({
        data: {
          workspaceId,
          filename: batch.filename,
          status: batch.status,
          totalRows: batch.totalRows,
          createdRows: batch.createdRows,
          duplicateRows: batch.duplicateRows,
          invalidRows: batch.invalidRows,
          skippedRows: batch.skippedRows,
          source: 'backup',
          notes: batch.notes ?? null,
          completedAt: new Date(),
        },
        select: { id: true },
      });
      batchIdByRef.set(batch.ref, created.id);
      batchesCreated += 1;
    }

    // Transactions. Refund links are resolved in a second pass so a refund may
    // appear in the document before the expense it reverses.
    const transactionIdByBackupId = new Map<string, string>();
    const pendingRefunds: { id: string; refundOfId: string }[] = [];
    let uncategorisedByMissingCategory = 0;
    let transactionsCreated = 0;

    const data: Prisma.TransactionCreateManyInput[] = backup.transactions.map((row) => {
      const categoryId = resolveCategory(row.categoryName, row.categoryKind);
      if (row.categoryName && !categoryId) uncategorisedByMissingCategory += 1;
      if (row.currency) assertSupportedCurrency(row.currency);
      transactionsCreated += 1;
      return {
        workspaceId,
        transactionDate: dateOnlyToUtcDate(row.transactionDate),
        description: row.description,
        merchant: row.merchant ?? null,
        normalizedMerchant: normalizeMerchant(row.merchant ?? null),
        amount: row.amount,
        type: row.type,
        categoryId,
        notes: row.notes ?? null,
        reviewStatus: row.reviewStatus ?? 'NEEDS_REVIEW',
        currency: row.currency ?? null,
        fingerprint: buildFingerprint({
          transactionDate: row.transactionDate,
          description: row.description,
          amount: row.amount,
          type: row.type,
          merchant: row.merchant ?? null,
        }),
        transferGroupId: row.transferGroupId ?? null,
        importBatchId: row.importBatchRef ? (batchIdByRef.get(row.importBatchRef) ?? null) : null,
        isSample: false,
      };
    });

    // createMany cannot return ids, so insert one by one when refund links exist.
    const needsLinks = backup.transactions.some((row) => row.refundOfId);
    if (!needsLinks) {
      if (data.length > 0) await tx.transaction.createMany({ data });
    } else {
      for (let index = 0; index < backup.transactions.length; index += 1) {
        const row = backup.transactions[index]!;
        const created = await tx.transaction.create({
          data: data[index]!,
          select: { id: true },
        });
        if (row.id) transactionIdByBackupId.set(row.id, created.id);
        if (row.refundOfId) pendingRefunds.push({ id: created.id, refundOfId: row.refundOfId });
      }
    }

    for (const pending of pendingRefunds) {
      const target = transactionIdByBackupId.get(pending.refundOfId);
      if (!target) continue;
      await tx.transaction.update({ where: { id: pending.id }, data: { refundOfTransactionId: target } });
    }

    // Budgets. Skip a duplicate (month, category) pair rather than failing.
    let budgetsCreated = 0;
    for (const budget of backup.budgets) {
      const categoryId = resolveCategory(budget.categoryName, budget.categoryKind);
      const month = `${budget.month}-01`;
      const clash = await tx.budget.findFirst({
        where: { workspaceId, month: dateOnlyToUtcDate(month), categoryId },
        select: { id: true },
      });
      if (clash) continue;
      await tx.budget.create({
        data: { workspaceId, month: dateOnlyToUtcDate(month), amount: budget.amount, categoryId },
      });
      budgetsCreated += 1;
    }

    // Category rules. Skip duplicates of an existing field+pattern pair.
    let rulesCreated = 0;
    for (const rule of backup.categoryRules ?? []) {
      const categoryId = resolveCategory(rule.categoryName, rule.categoryKind);
      if (!categoryId) continue;
      const pattern = normalizePattern(rule.pattern);
      const clash = await tx.categoryRule.findFirst({
        where: { workspaceId, matchField: rule.matchField, pattern },
        select: { id: true },
      });
      if (clash) continue;
      await tx.categoryRule.create({
        data: {
          workspaceId,
          matchField: rule.matchField,
          pattern,
          categoryId,
          priority: rule.priority,
          isActive: rule.isActive,
        },
      });
      rulesCreated += 1;
    }

    if (backup.settings) {
      await tx.settings.upsert({
        where: { workspaceId },
        create: { workspaceId, ...backup.settings },
        update: { ...backup.settings },
      });
    }

    return {
      mode: input.mode,
      transactions: transactionsCreated,
      categories: categoriesCreated,
      budgets: budgetsCreated,
      importBatches: batchesCreated,
      categoryRules: rulesCreated,
      uncategorisedByMissingCategory,
    };
  }, RESTORE_TRANSACTION_OPTIONS);
}
