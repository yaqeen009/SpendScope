import { parseDateOnly, toDateOnly } from '@spendscope/shared';

/**
 * The database column is `date` (no time, no timezone). Prisma round-trips it
 * as a `Date` pinned to UTC midnight, so conversions must use UTC getters to
 * avoid the classic off-by-one-day timezone bug.
 */
export function dateOnlyToUtcDate(value: string): Date {
  return parseDateOnly(value);
}

export function utcDateToDateOnly(value: Date): string {
  return toDateOnly(value);
}

/** Inclusive SQL range filter for a `date` column. */
export function dateOnlyRangeFilter(from?: string, to?: string): { gte?: Date; lte?: Date } {
  const filter: { gte?: Date; lte?: Date } = {};
  if (from) filter.gte = dateOnlyToUtcDate(from);
  if (to) filter.lte = dateOnlyToUtcDate(to);
  return filter;
}

/** First day of a `YYYY-MM` month key as a UTC date. */
export function monthKeyToUtcDate(month: string): Date {
  return dateOnlyToUtcDate(`${month}-01`);
}
