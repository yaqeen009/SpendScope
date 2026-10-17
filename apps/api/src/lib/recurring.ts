import type { RecurrenceCadence, RecurringSeriesDTO } from '@spendscope/shared';

import { addDays, compareDateOnly } from '@spendscope/shared';

import { normalizeMerchant } from './fingerprint.ts';

/**
 * Recurring-transaction detection.
 *
 * The algorithm is deliberately simple, deterministic and explainable — every
 * result can be justified in one sentence:
 *
 *  1. Group rows by a normalised name (merchant when present, else description).
 *     Normalisation lower-cases, strips accents and punctuation and collapses
 *     whitespace. Digits are kept, so a merchant whose reference number changes
 *     each month ("ShopRite 123" / "ShopRite 456") splits into separate series —
 *     a documented limitation rather than a guess.
 *  2. Keep groups with at least 3 rows that all have the **same amount**.
 *  3. Measure the gaps between consecutive dates. Keep the series when every gap
 *     is within tolerance of the median gap (a quarter of the median or 4 days,
 *     whichever is larger) and the median gap maps onto a known cadence.
 *
 * Nothing is inferred from the future, no machine learning is involved, and the
 * same data always produces the same list.
 */

/** Series need at least this many occurrences to be reported. */
export const MIN_OCCURRENCES = 3;

/** Known cadences and the interval range (in days) that maps to each. */
const CADENCE_RANGES: readonly { cadence: RecurrenceCadence; min: number; max: number }[] = [
  { cadence: 'weekly', min: 6, max: 8 },
  { cadence: 'fortnightly', min: 12, max: 16 },
  { cadence: 'monthly', min: 26, max: 35 },
  { cadence: 'quarterly', min: 82, max: 100 },
  { cadence: 'yearly', min: 350, max: 380 },
];

export const RECURRENCE_CADENCES: readonly RecurrenceCadence[] = CADENCE_RANGES.map((entry) => entry.cadence);

export interface RecurringRow {
  id: string;
  /** `YYYY-MM-DD`. */
  transactionDate: string;
  description: string;
  merchant: string | null;
  amount: string;
  type: string;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** Whole days between two `YYYY-MM-DD` values (never negative here). */
function dayDiff(from: string, to: string): number {
  const a = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const b = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}

function cadenceFor(intervalDays: number): RecurrenceCadence | null {
  for (const range of CADENCE_RANGES) {
    if (intervalDays >= range.min && intervalDays <= range.max) return range.cadence;
  }
  return null;
}

/**
 * The stable identity of a series. Used to remember dismissals, so it must not
 * depend on data that can grow (dates or occurrence counts).
 */
export function seriesKeyFor(name: string, amount: string): string {
  return `${name}|${amount}`;
}

export function detectRecurringSeries(rows: readonly RecurringRow[]): RecurringSeriesDTO[] {
  const groups = new Map<string, RecurringRow[]>();

  for (const row of rows) {
    if (row.type === 'TRANSFER') continue;
    const name = normalizeMerchant(row.merchant ?? row.description);
    if (!name) continue;
    const key = seriesKeyFor(name, row.amount);
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  const series: RecurringSeriesDTO[] = [];

  for (const [key, bucket] of groups) {
    if (bucket.length < MIN_OCCURRENCES) continue;

    const sorted = [...bucket].sort((a, b) =>
      a.transactionDate === b.transactionDate
        ? a.id.localeCompare(b.id)
        : compareDateOnly(a.transactionDate, b.transactionDate),
    );

    const gaps: number[] = [];
    for (let index = 1; index < sorted.length; index += 1) {
      gaps.push(dayDiff(sorted[index - 1]!.transactionDate, sorted[index]!.transactionDate));
    }
    // A series cannot repeat twice on the same day.
    if (gaps.some((gap) => gap <= 0)) continue;

    const medianGap = median(gaps);
    const cadence = cadenceFor(medianGap);
    if (!cadence) continue;

    const tolerance = Math.max(4, medianGap * 0.25);
    const consistent = gaps.every((gap) => Math.abs(gap - medianGap) <= tolerance);
    if (!consistent) continue;

    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    const amount = last.amount;
    const nextExpectedDate = addDays(last.transactionDate, Math.round(medianGap));

    series.push({
      seriesKey: key,
      name: first.merchant?.trim() || first.description,
      amount,
      type: last.type as RecurringSeriesDTO['type'],
      cadence,
      intervalDays: Math.round(medianGap),
      occurrences: sorted.length,
      firstDate: first.transactionDate,
      lastDate: last.transactionDate,
      nextExpectedDate,
      // Three sightings in a consistent rhythm is medium confidence; four or
      // more is high.
      confidence: sorted.length >= 4 ? 'high' : 'medium',
      transactionIds: sorted.map((row) => row.id),
      explanation: `${sorted.length} transactions of ${amount} for "${first.merchant?.trim() || first.description}", about every ${Math.round(medianGap)} days (${cadence})`,
      dismissed: false,
    });
  }

  // Deterministic order: the most recent activity first, then by name.
  return series.sort((a, b) => {
    if (a.lastDate !== b.lastDate) return compareDateOnly(b.lastDate, a.lastDate);
    return a.name.localeCompare(b.name);
  });
}
