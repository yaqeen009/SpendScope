import {
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  formatCurrency,
  formatCurrencyCompact,
  formatDateOnly,
  formatMonthKey,
  formatPercent,
  formatTimestamp,
  type BudgetProgressItem,
  type ImportStatus,
  type ReviewStatus,
  type TransactionType,
} from '@spendscope/shared';

/**
 * Display-only formatting helpers. All numeric formatting goes through the
 * shared `Intl.NumberFormat` wrappers so the API-generated CSV reports and the
 * UI always render a value identically.
 *
 * The currency setting changes formatting ONLY: amounts are never converted,
 * and the UI states this explicitly (see the settings page and docs).
 */
export { formatCurrency, formatCurrencyCompact, formatDateOnly, formatMonthKey, formatPercent, formatTimestamp };

export const FALLBACK_CURRENCY = DEFAULT_CURRENCY;
export const FALLBACK_LOCALE = DEFAULT_LOCALE;

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  INCOME: 'Income',
  EXPENSE: 'Expense',
  TRANSFER: 'Transfer',
  REFUND: 'Refund',
};

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  NEEDS_REVIEW: 'Needs review',
  REVIEWED: 'Reviewed',
};

export const IMPORT_STATUS_LABELS: Record<ImportStatus, string> = {
  COMPLETED: 'Completed',
  PARTIAL: 'Partial',
  FAILED: 'Failed',
};

export const BUDGET_STATE_LABELS: Record<BudgetProgressItem['state'], string> = {
  ok: 'On track',
  warning: 'Approaching limit',
  exceeded: 'Exceeded',
};

/** Human label for an import row status. */
export const IMPORT_ROW_STATUS_LABELS: Record<string, string> = {
  valid: 'Valid',
  invalid: 'Invalid',
  duplicate_exact: 'Duplicate',
  duplicate_possible: 'Possible duplicate',
};

/** Formats a signed delta as a percentage, or `—` when undefined. */
export function formatChange(fraction: number | null, locale: string = FALLBACK_LOCALE): string {
  if (fraction === null || !Number.isFinite(fraction)) return '—';
  const sign = fraction > 0 ? '+' : '';
  return `${sign}${formatPercent(fraction, locale)}`;
}

/**
 * Formats a byte count for the upload summary. Deliberately simple: CSV files
 * are small and an exact size is more useful than a rounded one.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "1 transaction" / "3 transactions". */
export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
