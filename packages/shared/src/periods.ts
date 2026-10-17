/**
 * Reporting-period resolution.
 *
 * A reporting period always has **inclusive** start and end semantics: a
 * transaction is in range when `start <= transactionDate <= end`. This rule is
 * applied identically on the backend (SQL range filter) and the frontend
 * (query parameters), so displayed totals always reconcile.
 */

import {
  addDays,
  addMonths,
  daysBetweenInclusive,
  endOfMonth,
  monthsBetweenInclusive,
  parseDateOnly,
  startOfMonth,
  startOfYear,
  todayDateOnly,
} from './date.ts';

export const PERIOD_KEYS = [
  'this_month',
  'last_month',
  'last_3_months',
  'this_year',
  'custom',
] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

export interface DateRange {
  /** Inclusive ISO date-only string, `YYYY-MM-DD`. */
  start: string;
  /** Inclusive ISO date-only string, `YYYY-MM-DD`. */
  end: string;
}

export interface ReportingPeriod extends DateRange {
  key: PeriodKey;
  /** Human-readable label describing the resolved range. */
  label: string;
}

export type Granularity = 'day' | 'week' | 'month';

export interface ResolvePeriodInput {
  key: PeriodKey;
  /** Required when `key` is `custom`. Inclusive `YYYY-MM-DD`. */
  from?: string | undefined;
  to?: string | undefined;
  /** Injectable "today" for deterministic tests. */
  today?: string;
}

function isMonthAligned(range: DateRange): boolean {
  return range.start === startOfMonth(range.start) && range.end === endOfMonth(range.end);
}

/** Resolves a period key (plus optional custom bounds) into a concrete range. */
export function resolvePeriod(input: ResolvePeriodInput): ReportingPeriod {
  const today = input.today ?? todayDateOnly();
  switch (input.key) {
    case 'this_month':
      return build('this_month', startOfMonth(today), endOfMonth(today));
    case 'last_month': {
      const prev = addMonths(startOfMonth(today), -1);
      return build('last_month', startOfMonth(prev), endOfMonth(prev));
    }
    case 'last_3_months': {
      const start = startOfMonth(addMonths(startOfMonth(today), -2));
      return build('last_3_months', start, endOfMonth(today));
    }
    case 'this_year':
      return build('this_year', startOfYear(today), `${today.slice(0, 4)}-12-31`);
    case 'custom': {
      const start = input.from ?? startOfMonth(today);
      const end = input.to ?? endOfMonth(today);
      const [lo, hi] = start <= end ? [start, end] : [end, start];
      return build('custom', lo, hi);
    }
  }
}

function build(key: PeriodKey, start: string, end: string): ReportingPeriod {
  return { key, start, end, label: `${start} → ${end}` };
}

/**
 * The equivalent period immediately before `range`.
 *
 * Month-aligned ranges are shifted back by whole months (so "March" compares
 * with "February" even though the months have different lengths). All other
 * ranges are shifted back by their own day count, producing a previous window
 * of identical length.
 */
export function previousPeriod(range: DateRange): DateRange {
  if (isMonthAligned(range)) {
    const months = monthsBetweenInclusive(range.start, range.end);
    const start = addMonths(range.start, -months);
    return { start, end: addMonths(range.end, -months) };
  }
  const span = daysBetweenInclusive(range.start, range.end);
  return { start: addDays(range.start, -span), end: addDays(range.start, -1) };
}

/**
 * Chooses the most readable aggregation granularity for a range:
 *   - up to 45 days  → daily points
 *   - up to 130 days → weekly points
 *   - longer         → monthly points
 */
export function granularityForRange(range: DateRange): Granularity {
  const days = daysBetweenInclusive(range.start, range.end);
  if (days <= 45) return 'day';
  if (days <= 130) return 'week';
  return 'month';
}

/** True when the range starts and ends on month boundaries. */
export function isFullMonthRange(range: DateRange): boolean {
  return isMonthAligned(range);
}

export function rangeContains(range: DateRange, date: string): boolean {
  return date >= range.start && date <= range.end;
}

export function rangeLengthDays(range: DateRange): number {
  return daysBetweenInclusive(range.start, range.end);
}

/** Sorts a range so `start <= end`. */
export function normalizeRange(range: DateRange): DateRange {
  return range.start <= range.end
    ? range
    : { start: range.end, end: range.start };
}

/** Parses an ISO date into UTC midnight; re-exported for convenience. */
export { parseDateOnly };
