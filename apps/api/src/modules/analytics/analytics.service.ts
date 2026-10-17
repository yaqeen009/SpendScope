import {
  formatCurrency,
  formatPercent,
  granularityForRange,
  monthsBetweenInclusive,
  monthKey,
  previousPeriod,
  resolvePeriod,
  type AnalyticsQuery,
  type CategoryBreakdownDTO,
  type CategoryBreakdownItem,
  type DashboardDTO,
  type MonthlyTrendDTO,
  type MonthlyTrendPoint,
  type PeriodMetrics,
  type SummaryMetricsDTO,
  type TimeSeriesDTO,
  type TransactionDTO,
} from '@spendscope/shared';

import { fetchCategoryExpenseTotals, fetchDailyAggregates, fetchMonthlyAggregates, fetchPeriodTotals } from '../../lib/aggregates.ts';
import { Decimal, decimalToString } from '../../lib/money.ts';
import { computeChange, computePeriodMetrics, toPeriodMetricsDTO } from '../../lib/finance.ts';
import { prisma } from '../../lib/prisma.ts';
import { toTransactionDTO } from '../../lib/serializers.ts';
import { getSettings } from '../settings/settings.service.ts';
import { getBudgetProgress } from '../budgets/budgets.service.ts';
import { buildInsights } from './insights.ts';
import { bucketKeyFor, buildBuckets } from './series.ts';

const CATEGORY_SELECT = { select: { id: true, name: true, kind: true, color: true } } as const;

async function metricsFor(
  workspaceId: string,
  range: { start: string; end: string },
): Promise<PeriodMetrics> {
  const totals = await fetchPeriodTotals(workspaceId, { from: range.start, to: range.end });
  return toPeriodMetricsDTO(computePeriodMetrics(totals));
}

export function resolveQueryPeriod(query: AnalyticsQuery): {
  period: ReturnType<typeof resolvePeriod>;
  granularity: ReturnType<typeof granularityForRange>;
} {
  const period = resolvePeriod({ key: query.period, from: query.from, to: query.to });
  return { period, granularity: granularityForRange(period) };
}

export async function getSummary(workspaceId: string, query: AnalyticsQuery): Promise<SummaryMetricsDTO> {
  const { period, granularity } = resolveQueryPeriod(query);
  const previous = query.compare ? previousPeriod(period) : null;

  const [current, previousMetrics] = await Promise.all([
    metricsFor(workspaceId, period),
    previous ? metricsFor(workspaceId, previous) : Promise.resolve(null),
  ]);

  const currentInternal = computePeriodMetricsFromDTO(current);
  const previousInternal = previousMetrics ? computePeriodMetricsFromDTO(previousMetrics) : null;

  return {
    period: { key: period.key, label: period.label, start: period.start, end: period.end },
    previousPeriod: previous,
    current,
    previous: previousMetrics,
    change: previousInternal ? computeChange(currentInternal, previousInternal) : null,
    granularity,
  };
}

/** Rebuilds the internal Decimal view from a DTO so change calculations stay decimal-safe. */
function computePeriodMetricsFromDTO(metrics: PeriodMetrics) {
  const expenses = new Decimal(metrics.expenses);
  const income = new Decimal(metrics.income);
  return {
    income,
    expenses,
    net: income.minus(expenses),
    savingsRate: metrics.savingsRate,
    transactionCount: metrics.transactionCount,
    uncategorizedExpenseTotal: new Decimal(metrics.uncategorizedExpenseTotal),
    uncategorizedCount: metrics.uncategorizedCount,
    foreignCurrency: metrics.foreignCurrency,
  };
}

export async function getTimeSeries(
  workspaceId: string,
  range: { start: string; end: string },
  granularity = granularityForRange(range),
): Promise<TimeSeriesDTO> {
  const daily = await fetchDailyAggregates(workspaceId, { from: range.start, to: range.end });
  const buckets = buildBuckets(range, granularity);

  const totals = new Map<string, { income: Decimal; expenses: Decimal }>();
  for (const [date, value] of daily) {
    const key = bucketKeyFor(date, granularity);
    const current = totals.get(key) ?? { income: new Decimal(0), expenses: new Decimal(0) };
    current.income = current.income.plus(value.income);
    current.expenses = current.expenses.plus(value.expenses);
    totals.set(key, current);
  }

  return {
    granularity,
    range: { start: range.start, end: range.end },
    points: buckets.map((bucket) => {
      const value = totals.get(bucket.key) ?? { income: new Decimal(0), expenses: new Decimal(0) };
      return {
        bucket: bucket.key,
        label: bucket.label,
        income: decimalToString(value.income),
        expenses: decimalToString(value.expenses),
        net: decimalToString(value.income.minus(value.expenses)),
      };
    }),
  };
}

export async function getCategoryBreakdown(
  workspaceId: string,
  range: { start: string; end: string },
): Promise<CategoryBreakdownDTO> {
  const [totals, categories] = await Promise.all([
    fetchCategoryExpenseTotals(workspaceId, { from: range.start, to: range.end }),
    prisma.category.findMany({ where: { workspaceId }, select: { id: true, name: true, kind: true, color: true } }),
  ]);

  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const grandTotal = totals.total;

  const items: CategoryBreakdownItem[] = [];
  for (const [categoryId, total] of totals.byCategory) {
    const category = categoryById.get(categoryId);
    if (!category) continue;
    items.push({
      categoryId,
      name: category.name,
      color: category.color,
      kind: category.kind,
      total: decimalToString(total),
      share: grandTotal.gt(0) ? total.div(grandTotal).toNumber() : 0,
      transactionCount: totals.counts.get(categoryId) ?? 0,
    });
  }

  if (totals.uncategorizedCount > 0 || !totals.uncategorized.isZero()) {
    items.push({
      categoryId: null,
      name: 'Uncategorized',
      color: null,
      kind: 'EXPENSE',
      total: decimalToString(totals.uncategorized),
      share: grandTotal.gt(0) ? totals.uncategorized.div(grandTotal).toNumber() : 0,
      transactionCount: totals.uncategorizedCount,
    });
  }

  items.sort((a, b) => Number(b.total) - Number(a.total));

  return { range: { start: range.start, end: range.end }, total: decimalToString(grandTotal), items };
}

export async function getMonthlyTrend(
  workspaceId: string,
  range: { start: string; end: string },
  maxMonths = 12,
): Promise<MonthlyTrendDTO> {
  const span = Math.min(Math.max(monthsBetweenInclusive(range.start, range.end), 6), maxMonths);
  const endMonth = monthKey(range.end);

  const monthKeys: string[] = [];
  const [year, month] = endMonth.split('-').map(Number) as [number, number];
  for (let i = span - 1; i >= 0; i -= 1) {
    const cursor = year * 12 + (month - 1) - i;
    const y = Math.floor(cursor / 12);
    const m = cursor % 12;
    monthKeys.push(`${String(y).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}`);
  }

  const from = `${monthKeys[0]}-01`;
  const aggregates = await fetchMonthlyAggregates(workspaceId, { from, to: range.end });

  const months: MonthlyTrendPoint[] = monthKeys.map((key) => {
    const value = aggregates.get(key);
    const income = value?.income ?? new Decimal(0);
    const expenses = value?.expenses ?? new Decimal(0);
    return {
      month: key,
      income: decimalToString(income),
      expenses: decimalToString(expenses),
      net: decimalToString(income.minus(expenses)),
    };
  });

  return { range: { start: from, end: range.end }, months };
}

export async function getRecentTransactions(
  workspaceId: string,
  range: { start: string; end: string },
  limit: number,
): Promise<TransactionDTO[]> {
  // Recent transactions are a display list, not a total, so foreign-currency rows
  // are included and show their own currency. Every aggregate excludes them.
  const rows = await prisma.transaction.findMany({
    where: {
      workspaceId,
      transactionDate: { gte: new Date(`${range.start}T00:00:00Z`), lte: new Date(`${range.end}T00:00:00Z`) },
    },
    include: { category: CATEGORY_SELECT },
    orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
    take: limit,
  });
  return rows.map((row) => toTransactionDTO(row));
}

export async function getLargestExpenses(
  workspaceId: string,
  range: { start: string; end: string },
  limit: number,
): Promise<TransactionDTO[]> {
  // Ranking "largest" across currencies would compare incomparable amounts, so
  // this list is restricted to the base currency, like every other aggregate.
  const rows = await prisma.transaction.findMany({
    where: {
      workspaceId,
      currency: null,
      type: 'EXPENSE',
      transactionDate: { gte: new Date(`${range.start}T00:00:00Z`), lte: new Date(`${range.end}T00:00:00Z`) },
    },
    include: { category: CATEGORY_SELECT },
    orderBy: [{ amount: 'desc' }, { transactionDate: 'desc' }],
    take: limit,
  });
  return rows.map((row) => toTransactionDTO(row));
}

export async function getDashboard(workspaceId: string, query: AnalyticsQuery): Promise<DashboardDTO> {
  const { period, granularity } = resolveQueryPeriod(query);
  const budgetMonth = monthKey(period.end);

  const [summary, timeSeries, categoryBreakdown, monthlyTrend, recentTransactions, largestExpenses, budgetProgress, settings, totalCount] =
    await Promise.all([
      getSummary(workspaceId, query),
      getTimeSeries(workspaceId, period, granularity),
      getCategoryBreakdown(workspaceId, period),
      getMonthlyTrend(workspaceId, period),
      getRecentTransactions(workspaceId, period, query.recentLimit),
      getLargestExpenses(workspaceId, period, 5),
      getBudgetProgress(workspaceId, budgetMonth),
      getSettings(workspaceId),
      prisma.transaction.count({ where: { workspaceId } }),
    ]);

  const currency = (value: number): string => formatCurrency(value, settings.currency, settings.locale);
  const percent = (fraction: number): string => formatPercent(fraction, settings.locale);

  const subscriptions = categoryBreakdown.items.find((item) => item.name === 'Subscriptions');
  const largest = largestExpenses[0];

  const insights = buildInsights({
    income: Number(summary.current.income),
    expenses: Number(summary.current.expenses),
    net: Number(summary.current.net),
    savingsRate: summary.current.savingsRate,
    previousExpenses: summary.previous ? Number(summary.previous.expenses) : null,
    topCategory: categoryBreakdown.items[0] && categoryBreakdown.items[0].categoryId !== null
      ? {
          name: categoryBreakdown.items[0].name,
          share: categoryBreakdown.items[0].share,
          total: Number(categoryBreakdown.items[0].total),
        }
      : null,
    uncategorizedCount: summary.current.uncategorizedCount,
    largestExpense: largest
      ? { description: largest.description, amount: Number(largest.amount) }
      : null,
    exceededBudgets: budgetProgress.items.filter((item) => item.state === 'exceeded' && !item.isTotalBudget).length,
    warningBudgets: budgetProgress.items.filter((item) => item.state === 'warning').length,
    subscriptionsTotal: subscriptions ? Number(subscriptions.total) : 0,
    currency,
    percent,
  });

  return {
    summary,
    timeSeries,
    categoryBreakdown,
    monthlyTrend,
    recentTransactions,
    largestExpenses,
    budgetProgress,
    insights: { insights },
    empty: totalCount === 0,
  };
}
