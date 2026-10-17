/**
 * Date-only helpers.
 *
 * Transaction dates are calendar dates with no time and no timezone. They are
 * represented everywhere (API, database, UI) as ISO `YYYY-MM-DD` strings and
 * converted to `Date` objects only at UTC midnight. This avoids the classic
 * bug where a local timezone shifts a stored date by one day.
 *
 * System timestamps (created/updated/import time) are separate: they use UTC
 * `Date`/`timestamptz` values and are not handled here.
 */

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month1to12: number): number {
  switch (month1to12) {
    case 1:
    case 3:
    case 5:
    case 7:
    case 8:
    case 10:
    case 12:
      return 31;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    case 2:
      return isLeapYear(year) ? 29 : 28;
    default:
      throw new RangeError(`Invalid month: ${month1to12}`);
  }
}

/** Returns true when `value` is a syntactically and calendrically valid `YYYY-MM-DD`. */
export function isValidDateOnly(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE_ONLY_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  return true;
}

/** Parses `YYYY-MM-DD` into a `Date` pinned to UTC midnight. */
export function parseDateOnly(value: string): Date {
  if (!isValidDateOnly(value)) {
    throw new RangeError(`Invalid date-only value: ${String(value)}`);
  }
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

/** Formats a `Date` as a `YYYY-MM-DD` string using its UTC calendar parts. */
export function toDateOnly(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError('Cannot format an invalid Date');
  }
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayDateOnly(now: Date = new Date()): string {
  return toDateOnly(now);
}

/** Adds (or subtracts) whole days to a date-only string. */
export function addDays(value: string, days: number): string {
  const date = parseDateOnly(value);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateOnly(date);
}

/** Adds (or subtracts) whole months, clamping the day to the target month length. */
export function addMonths(value: string, months: number): string {
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const total = (y * 12 + (m - 1)) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12 + 12) % 12;
  const day = Math.min(d, daysInMonth(year, month + 1));
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function startOfMonth(value: string): string {
  const [y, m] = value.split('-').map(Number) as [number, number];
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`;
}

export function endOfMonth(value: string): string {
  const [y, m] = value.split('-').map(Number) as [number, number];
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(daysInMonth(y, m)).padStart(2, '0')}`;
}

export function startOfYear(value: string): string {
  return `${value.slice(0, 4)}-01-01`;
}

/** `YYYY-MM` key for the month containing `value`. */
export function monthKey(value: string): string {
  return value.slice(0, 7);
}

/** First day of the month identified by a `YYYY-MM` key, as `YYYY-MM-DD`. */
export function monthKeyToDate(month: string): string {
  return `${month}-01`;
}

/** Inclusive day count between two date-only values. */
export function daysBetweenInclusive(start: string, end: string): number {
  const ms = parseDateOnly(end).getTime() - parseDateOnly(start).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

/** Number of calendar months spanned (inclusive) between two date-only values. */
export function monthsBetweenInclusive(start: string, end: string): number {
  const [sy, sm] = start.split('-').map(Number) as [number, number];
  const [ey, em] = end.split('-').map(Number) as [number, number];
  return (ey * 12 + em) - (sy * 12 + sm) + 1;
}

export function compareDateOnly(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minDateOnly(a: string, b: string): string {
  return compareDateOnly(a, b) <= 0 ? a : b;
}

export function maxDateOnly(a: string, b: string): string {
  return compareDateOnly(a, b) >= 0 ? a : b;
}
