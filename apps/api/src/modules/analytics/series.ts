import {
  addDays,
  endOfMonth,
  formatDateOnly,
  formatMonthKey,
  monthKey,
  startOfMonth,
  type DateRange,
  type Granularity,
} from '@spendscope/shared';

/**
 * Bucketing for the income-vs-expense time series.
 *
 * Pure functions so the boundary behaviour (month ends, leap years, weeks that
 * straddle two months) is unit-tested rather than eyeballed on a chart.
 */

export interface Bucket {
  key: string;
  label: string;
  start: string;
  end: string;
}

/** Monday-based week start (ISO 8601). */
export function startOfWeek(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const offset = day === 0 ? -6 : 1 - day;
  return addDays(date, offset);
}

function clampRange(date: string, range: DateRange): { start: string; end: string } {
  return { start: date < range.start ? range.start : date, end: date > range.end ? range.end : date };
}

export function buildBuckets(range: DateRange, granularity: Granularity): Bucket[] {
  const buckets: Bucket[] = [];

  if (granularity === 'month') {
    let cursor = startOfMonth(range.start);
    while (cursor <= range.end) {
      const monthEnd = endOfMonth(cursor);
      const bounds = clampRange(cursor, range);
      buckets.push({
        key: monthKey(cursor),
        label: formatMonthKey(monthKey(cursor)),
        start: bounds.start,
        end: monthEnd > range.end ? range.end : monthEnd,
      });
      cursor = addDays(monthEnd, 1);
    }
    return buckets;
  }

  if (granularity === 'week') {
    let cursor = startOfWeek(range.start);
    while (cursor <= range.end) {
      const weekEnd = addDays(cursor, 6);
      const bounds = clampRange(cursor, range);
      buckets.push({
        key: cursor,
        label: `Week of ${formatDateOnly(bounds.start)}`,
        start: bounds.start,
        end: weekEnd > range.end ? range.end : weekEnd,
      });
      cursor = addDays(cursor, 7);
    }
    return buckets;
  }

  let cursor = range.start;
  while (cursor <= range.end) {
    buckets.push({
      key: cursor,
      label: formatDateOnly(cursor),
      start: cursor,
      end: cursor,
    });
    cursor = addDays(cursor, 1);
  }
  return buckets;
}

/** The bucket key a given transaction date belongs to. */
export function bucketKeyFor(date: string, granularity: Granularity): string {
  if (granularity === 'month') return monthKey(date);
  if (granularity === 'week') return startOfWeek(date);
  return date;
}
