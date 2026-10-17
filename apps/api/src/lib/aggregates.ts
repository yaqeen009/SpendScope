import { dateOnlyRangeFilter } from './dates.ts';
import { Decimal } from './money.ts';
import { prisma } from './prisma.ts';
import type { Prisma } from './prisma.ts';

/**
 * Reusable database aggregation helpers.
 *
 * All period totals are computed **in the database** (SQL `GROUP BY` + `SUM`)
 * rather than by loading every transaction into memory. Every helper takes an
 * inclusive date range and is scoped to a workspace.
 */

export interface Range {
  from?: string;
  to?: string;
}

export interface PeriodTotalsResult {
  income: Decimal;
  expenses: Decimal;
  refunds: Decimal;
  /** Number of transactions of any type in the period (including transfers). */
  transactionCount: number;
  uncategorizedExpenseTotal: Decimal;
  uncategorizedCount: number;
}

export async function fetchPeriodTotals(
  workspaceId: string,
  range: Range,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<PeriodTotalsResult> {
  const transactionDate = dateOnlyRangeFilter(range.from, range.to);

  const [byType, uncategorized, total] = await Promise.all([
    client.transaction.groupBy({
      by: ['type'],
      where: { workspaceId, transactionDate },
      _sum: { amount: true },
    }),
    client.transaction.groupBy({
      by: ['type'],
      where: { workspaceId, transactionDate, categoryId: null, type: { in: ['EXPENSE', 'REFUND'] } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    client.transaction.count({ where: { workspaceId, transactionDate } }),
  ]);

  const sumFor = (type: 'INCOME' | 'EXPENSE' | 'REFUND'): Decimal => {
    const row = byType.find((entry) => entry.type === type);
    return row?._sum.amount ?? new Decimal(0);
  };

  let uncategorizedExpenseTotal = new Decimal(0);
  let uncategorizedCount = 0;
  for (const row of uncategorized) {
    const amount = row._sum.amount ?? new Decimal(0);
    uncategorizedExpenseTotal =
      row.type === 'REFUND'
        ? uncategorizedExpenseTotal.minus(amount)
        : uncategorizedExpenseTotal.plus(amount);
    uncategorizedCount += row._count._all;
  }

  return {
    income: sumFor('INCOME'),
    expenses: sumFor('EXPENSE'),
    refunds: sumFor('REFUND'),
    transactionCount: total,
    uncategorizedExpenseTotal,
    uncategorizedCount,
  };
}

export interface CategoryExpenseTotals {
  /** Net expense magnitude per category id (null = uncategorized). */
  byCategory: Map<string, Decimal>;
  uncategorized: Decimal;
  total: Decimal;
  counts: Map<string, number>;
  uncategorizedCount: number;
}

/** Net expense spend per category over a range (EXPENSE − REFUND). */
export async function fetchCategoryExpenseTotals(
  workspaceId: string,
  range: Range,
): Promise<CategoryExpenseTotals> {
  const grouped = await prisma.transaction.groupBy({
    by: ['categoryId', 'type'],
    where: {
      workspaceId,
      transactionDate: dateOnlyRangeFilter(range.from, range.to),
      type: { in: ['EXPENSE', 'REFUND'] },
    },
    _sum: { amount: true },
    _count: { _all: true },
  });

  const byCategory = new Map<string, Decimal>();
  const counts = new Map<string, number>();
  let uncategorized = new Decimal(0);
  let uncategorizedCount = 0;
  let total = new Decimal(0);

  for (const row of grouped) {
    const amount = row._sum.amount ?? new Decimal(0);
    const delta = row.type === 'REFUND' ? amount.negated() : amount;
    total = total.plus(delta);
    if (row.categoryId === null) {
      uncategorized = uncategorized.plus(delta);
      uncategorizedCount += row._count._all;
      continue;
    }
    byCategory.set(row.categoryId, (byCategory.get(row.categoryId) ?? new Decimal(0)).plus(delta));
    counts.set(row.categoryId, (counts.get(row.categoryId) ?? 0) + row._count._all);
  }

  return { byCategory, uncategorized, total, counts, uncategorizedCount };
}

/** Monthly income/expense/net series, one entry per calendar month in range. */
export interface MonthlyAggregate {
  month: string;
  income: Decimal;
  expenses: Decimal;
}

export async function fetchMonthlyAggregates(
  workspaceId: string,
  range: Range,
): Promise<Map<string, MonthlyAggregate>> {
  const from = range.from ?? '1970-01-01';
  const to = range.to ?? '2999-12-31';

  const rows = await prisma.$queryRaw<
    { month: Date; type: string; total: string }[]
  >`
    SELECT date_trunc('month', "transactionDate")::date AS month,
           "type"::text AS type,
           COALESCE(SUM("amount"), 0)::text AS total
    FROM "Transaction"
    WHERE "workspaceId" = ${workspaceId}::uuid
      AND "transactionDate" >= ${from}::date
      AND "transactionDate" <= ${to}::date
      AND "type" IN ('INCOME', 'EXPENSE', 'REFUND')
    GROUP BY 1, 2
    ORDER BY 1 ASC
  `;

  const result = new Map<string, MonthlyAggregate>();
  for (const row of rows) {
    const month = row.month.toISOString().slice(0, 7);
    const current = result.get(month) ?? { month, income: new Decimal(0), expenses: new Decimal(0) };
    const amount = new Decimal(row.total);
    if (row.type === 'INCOME') current.income = current.income.plus(amount);
    else if (row.type === 'EXPENSE') current.expenses = current.expenses.plus(amount);
    else current.expenses = current.expenses.minus(amount);
    result.set(month, current);
  }
  return result;
}

export interface DailyAggregate {
  income: Decimal;
  expenses: Decimal;
}

/**
 * Daily income and net-expense totals for a range. Used to build the
 * day/week/month time series in one pass instead of N queries.
 */
export async function fetchDailyAggregates(
  workspaceId: string,
  range: Range,
): Promise<Map<string, DailyAggregate>> {
  const from = range.from ?? '1970-01-01';
  const to = range.to ?? '2999-12-31';

  const rows = await prisma.$queryRaw<{ day: Date; type: string; total: string }[]>`
    SELECT "transactionDate" AS day,
           "type"::text AS type,
           COALESCE(SUM("amount"), 0)::text AS total
    FROM "Transaction"
    WHERE "workspaceId" = ${workspaceId}::uuid
      AND "transactionDate" >= ${from}::date
      AND "transactionDate" <= ${to}::date
      AND "type" IN ('INCOME', 'EXPENSE', 'REFUND')
    GROUP BY 1, 2
    ORDER BY 1 ASC
  `;

  const result = new Map<string, DailyAggregate>();
  for (const row of rows) {
    const day = row.day.toISOString().slice(0, 10);
    const current = result.get(day) ?? { income: new Decimal(0), expenses: new Decimal(0) };
    const amount = new Decimal(row.total);
    if (row.type === 'INCOME') current.income = current.income.plus(amount);
    else if (row.type === 'EXPENSE') current.expenses = current.expenses.plus(amount);
    else current.expenses = current.expenses.minus(amount);
    result.set(day, current);
  }
  return result;
}
