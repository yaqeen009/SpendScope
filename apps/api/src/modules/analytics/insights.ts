import type { Insight } from '@spendscope/shared';

/**
 * Deterministic insights.
 *
 * These are plain arithmetic statements over the same aggregates the charts use
 * — no machine learning, no external service, no speculation. Each insight
 * states the figure it is based on so the user can verify it.
 */

export interface InsightInput {
  income: number;
  expenses: number;
  net: number;
  savingsRate: number | null;
  previousExpenses: number | null;
  topCategory: { name: string; share: number; total: number } | null;
  uncategorizedCount: number;
  largestExpense: { description: string; amount: number } | null;
  exceededBudgets: number;
  warningBudgets: number;
  subscriptionsTotal: number;
  currency: (value: number) => string;
  percent: (fraction: number) => string;
}

export function buildInsights(input: InsightInput): Insight[] {
  const insights: Insight[] = [];

  if (input.income > 0 || input.expenses > 0) {
    if (input.net >= 0) {
      insights.push({
        id: 'net-positive',
        severity: 'positive',
        title: 'You ended the period in surplus',
        detail:
          input.savingsRate !== null
            ? `Net cash flow was ${input.currency(input.net)}, a savings rate of ${input.percent(input.savingsRate)} of income.`
            : `Net cash flow was ${input.currency(input.net)}. Savings rate is unavailable because income was zero.`,
      });
    } else {
      insights.push({
        id: 'net-negative',
        severity: 'warning',
        title: 'You spent more than you earned',
        detail: `Net cash flow was ${input.currency(input.net)} (expenses ${input.currency(input.expenses)} against income ${input.currency(input.income)}).`,
      });
    }
  }

  if (input.topCategory && input.topCategory.share >= 0.3) {
    insights.push({
      id: 'top-category',
      severity: 'info',
      title: `${input.topCategory.name} is your largest category`,
      detail: `${input.topCategory.name} accounted for ${input.percent(input.topCategory.share)} of spending (${input.currency(input.topCategory.total)}).`,
    });
  }

  if (input.previousExpenses !== null && input.previousExpenses > 0) {
    const change = (input.expenses - input.previousExpenses) / input.previousExpenses;
    if (change >= 0.15) {
      insights.push({
        id: 'expenses-up',
        severity: 'warning',
        title: 'Spending increased versus the previous period',
        detail: `Expenses are up ${input.percent(change)} compared with the previous period (${input.currency(input.previousExpenses)} → ${input.currency(input.expenses)}).`,
      });
    } else if (change <= -0.15) {
      insights.push({
        id: 'expenses-down',
        severity: 'positive',
        title: 'Spending decreased versus the previous period',
        detail: `Expenses are down ${input.percent(Math.abs(change))} compared with the previous period (${input.currency(input.previousExpenses)} → ${input.currency(input.expenses)}).`,
      });
    }
  }

  if (input.exceededBudgets > 0) {
    insights.push({
      id: 'budgets-exceeded',
      severity: 'warning',
      title: `${input.exceededBudgets} budget${input.exceededBudgets === 1 ? '' : 's'} exceeded`,
      detail: 'At least one category budget is over its limit for this period.',
    });
  } else if (input.warningBudgets > 0) {
    insights.push({
      id: 'budgets-warning',
      severity: 'info',
      title: `${input.warningBudgets} budget${input.warningBudgets === 1 ? '' : 's'} approaching the limit`,
      detail: 'These budgets have used 80% or more of their allowance.',
    });
  }

  if (input.uncategorizedCount > 0) {
    insights.push({
      id: 'uncategorized',
      severity: 'info',
      title: `${input.uncategorizedCount} uncategorized transaction${input.uncategorizedCount === 1 ? '' : 's'}`,
      detail: 'Categorizing them will make the category breakdown more accurate.',
    });
  }

  if (input.subscriptionsTotal > 0) {
    insights.push({
      id: 'subscriptions',
      severity: 'info',
      title: 'Recurring subscriptions',
      detail: `Subscriptions added up to ${input.currency(input.subscriptionsTotal)} in this period.`,
    });
  }

  if (input.largestExpense) {
    insights.push({
      id: 'largest-expense',
      severity: 'info',
      title: 'Largest single expense',
      detail: `${input.largestExpense.description} — ${input.currency(input.largestExpense.amount)}.`,
    });
  }

  if (insights.length === 0) {
    insights.push({
      id: 'no-data',
      severity: 'info',
      title: 'Not enough data yet',
      detail: 'Import transactions or load the demo dataset to see insights for this period.',
    });
  }

  return insights;
}
