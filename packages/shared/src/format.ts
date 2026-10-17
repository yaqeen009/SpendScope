/**
 * Locale-aware formatting helpers shared by the API (CSV reports) and the web
 * app. Formatting never performs currency conversion — see
 * docs/DECISIONS.md ("Currency display is formatting-only").
 */

export const SUPPORTED_CURRENCIES = [
  'GHS',
  'USD',
  'EUR',
  'GBP',
  'NGN',
  'ZAR',
  'KES',
  'CAD',
  'AUD',
] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export const DEFAULT_CURRENCY: SupportedCurrency = 'GHS';
export const DEFAULT_LOCALE = 'en-GH';

const currencyFormatters = new Map<string, Intl.NumberFormat>();

function currencyFormatter(currency: string, locale: string): Intl.NumberFormat {
  const key = `${locale}:${currency}`;
  let formatter = currencyFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    currencyFormatters.set(key, formatter);
  }
  return formatter;
}

/**
 * Formats a decimal string (or number) as a currency amount. The value is
 * parsed with `Number` for display only; all stored arithmetic stays decimal.
 */
export function formatCurrency(
  value: string | number,
  currency: string = DEFAULT_CURRENCY,
  locale: string = DEFAULT_LOCALE,
): string {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return '—';
  return currencyFormatter(currency, locale).format(numeric);
}

/** Compact currency for chart axes, e.g. `GH₵1.2K`. */
export function formatCurrencyCompact(
  value: string | number,
  currency: string = DEFAULT_CURRENCY,
  locale: string = DEFAULT_LOCALE,
): string {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return '—';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(numeric);
}

export function formatPercent(fraction: number, locale: string = DEFAULT_LOCALE): string {
  if (!Number.isFinite(fraction)) return '—';
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(fraction);
}

/** Formats a `YYYY-MM-DD` string as a medium date, pinned to UTC. */
export function formatDateOnly(value: string | null, locale: string = DEFAULT_LOCALE): string {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    timeZone: 'UTC',
  }).format(date);
}

/** Formats a `YYYY-MM` month key, e.g. `Mar 2026`. */
export function formatMonthKey(value: string, locale: string = DEFAULT_LOCALE): string {
  const date = new Date(`${value}-01T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(date);
}

/** Formats a UTC timestamp for display. */
export function formatTimestamp(value: string | Date | null, locale: string = DEFAULT_LOCALE): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}
