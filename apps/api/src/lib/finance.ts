import type {
  BudgetProgressItem,
  CategoryKind,
  ImportStatus,
  PeriodChange,
  PeriodMetrics,
  ReviewStatus,
  TransactionType,
} from '@spendscope/shared';
import { percentChange, savingsRateFraction } from '@spendscope/shared';

import { budgetState, decimalToString, usageFraction } from './money.ts';
import type { Decimal } from './money.ts';

/**
 * Financial calculations, expressed on Prisma `Decimal` values.
 *
 * Rules (kept in sync with docs/FINANCIAL_RULES.md):
 *   income      = Σ amount where type = INCOME
 *   refunds     = Σ amount where type = REFUND
 *   expenses    = Σ amount where type = EXPENSE  −  refunds        (never < 0 is NOT enforced;
 *                 a refund without a matching expense legitimately produces net negative "spend")
 *   net         = income − expenses
 *   savingsRate = net / income, or null when income <= 0
 *   transfers   = excluded from every total above
 *
 * All arithmetic uses decimal.js through Prisma, never IEEE-754 floats.
 */

export interface RawPeriodTotals {
  income: Decimal;
  expenses: Decimal;
  refunds: Decimal;
  transactionCount: number;
  uncategorizedExpenseTotal: Decimal;
  uncategorizedCount: number;
}

export interface PeriodMetricsInternal {
  income: Decimal;
  expenses: Decimal;
  net: Decimal;
  savingsRate: number | null;
  transactionCount: number;
  uncategorizedExpenseTotal: Decimal;
  uncategorizedCount: number;
}

export function computePeriodMetrics(totals: RawPeriodTotals): PeriodMetricsInternal {
  const netExpenses = totals.expenses.minus(totals.refunds);
  const net = totals.income.minus(netExpenses);
  return {
    income: totals.income,
    expenses: netExpenses,
    net,
    savingsRate: savingsRateFraction(decimalToString(net), decimalToString(totals.income)),
    transactionCount: totals.transactionCount,
    uncategorizedExpenseTotal: totals.uncategorizedExpenseTotal,
    uncategorizedCount: totals.uncategorizedCount,
  };
}

/** Serialises internal metrics to the wire format (decimal strings). */
export function toPeriodMetricsDTO(metrics: PeriodMetricsInternal): PeriodMetrics {
  return {
    income: decimalToString(metrics.income),
    expenses: decimalToString(metrics.expenses),
    net: decimalToString(metrics.net),
    savingsRate: metrics.savingsRate,
    transactionCount: metrics.transactionCount,
    uncategorizedExpenseTotal: decimalToString(metrics.uncategorizedExpenseTotal),
    uncategorizedCount: metrics.uncategorizedCount,
  };
}

export function computeChange(
  current: PeriodMetricsInternal,
  previous: PeriodMetricsInternal,
): PeriodChange {
  const savingsRate =
    current.savingsRate !== null && previous.savingsRate !== null
      ? current.savingsRate - previous.savingsRate
      : null;
  return {
    income: percentChange(decimalToString(current.income), decimalToString(previous.income)),
    expenses: percentChange(decimalToString(current.expenses), decimalToString(previous.expenses)),
    net: percentChange(decimalToString(current.net), decimalToString(previous.net)),
    savingsRate,
  };
}

export interface BudgetProgressInput {
  budgetId: string;
  month: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  budgetAmount: Decimal;
  spent: Decimal;
}

export function computeBudgetProgress(input: BudgetProgressInput): BudgetProgressItem {
  const percentUsed = usageFraction(input.spent, input.budgetAmount);
  return {
    budgetId: input.budgetId,
    month: input.month,
    categoryId: input.categoryId,
    categoryName: input.categoryName,
    categoryColor: input.categoryColor,
    budgetAmount: decimalToString(input.budgetAmount),
    spent: decimalToString(input.spent),
    remaining: decimalToString(input.budgetAmount.minus(input.spent)),
    percentUsed,
    state: budgetState(percentUsed),
    isTotalBudget: input.categoryId === null,
  };
}

/** Re-exported so services can build DTOs without importing the raw enums twice. */
export type { CategoryKind, ImportStatus, ReviewStatus, TransactionType };
