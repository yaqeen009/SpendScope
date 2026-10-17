import { describe, expect, it } from 'vitest';

import { detectRecurringSeries, type RecurringRow } from './recurring.ts';

/**
 * Unit tests for the recurrence detector.
 *
 * The detector is pure, so these cover the rules directly: minimum occurrences,
 * equal amounts, a consistent rhythm, cadence mapping and dismissal keys.
 */

function row(overrides: Partial<RecurringRow> & { transactionDate: string }): RecurringRow {
  return {
    id: overrides.id ?? `id-${overrides.transactionDate}`,
    description: 'Netflix subscription',
    merchant: 'Netflix',
    amount: '95.00',
    type: 'EXPENSE',
    ...overrides,
  };
}

function monthly(name = 'Netflix', amount = '95.00', start = '2026-01-05', count = 4): RecurringRow[] {
  const months = ['2026-01-05', '2026-02-05', '2026-03-05', '2026-04-05', '2026-05-05', '2026-06-05'];
  return months.slice(0, count).map((_, index) => {
    const [year, month, day] = start.split('-').map(Number) as [number, number, number];
    const date = new Date(Date.UTC(year, month - 1 + index, day)).toISOString().slice(0, 10);
    return row({ id: `${name}-${index}`, transactionDate: date, merchant: name, description: name, amount });
  });
}

describe('detectRecurringSeries', () => {
  it('detects a monthly series and explains it', () => {
    const series = detectRecurringSeries(monthly());

    expect(series).toHaveLength(1);
    const detected = series[0]!;
    expect(detected).toMatchObject({
      name: 'Netflix',
      amount: '95.00',
      cadence: 'monthly',
      intervalDays: 31,
      occurrences: 4,
      confidence: 'high',
      dismissed: false,
      seriesKey: 'netflix|95.00',
    });
    expect(detected.lastDate).toBe('2026-04-05');
    expect(detected.nextExpectedDate).toBe('2026-05-06');
    expect(detected.explanation).toContain('4 transactions of 95.00');
    expect(detected.transactionIds).toHaveLength(4);
  });

  it('requires at least three occurrences', () => {
    expect(detectRecurringSeries(monthly('Netflix', '95.00', '2026-01-05', 2))).toHaveLength(0);
    expect(detectRecurringSeries(monthly('Netflix', '95.00', '2026-01-05', 3))).toHaveLength(1);
  });

  it('reports medium confidence for exactly three occurrences', () => {
    const series = detectRecurringSeries(monthly('Netflix', '95.00', '2026-01-05', 3));
    expect(series[0]!.confidence).toBe('medium');
  });

  it('splits series whose amounts differ', () => {
    const rows = monthly();
    rows[2] = { ...rows[2]!, amount: '120.00' };
    // Two rows at 95.00 and one at 120.00 is not enough for either series.
    expect(detectRecurringSeries(rows)).toHaveLength(0);
  });

  it('rejects an irregular rhythm', () => {
    const rows = [
      row({ id: 'a', transactionDate: '2026-01-05' }),
      row({ id: 'b', transactionDate: '2026-01-09' }), // 4 days later
      row({ id: 'c', transactionDate: '2026-04-20' }), // 101 days later
    ];
    expect(detectRecurringSeries(rows)).toHaveLength(0);
  });

  it('accepts a small amount of drift around a cadence', () => {
    const rows = [
      row({ id: 'a', transactionDate: '2026-01-05' }),
      row({ id: 'b', transactionDate: '2026-02-03' }), // 29 days
      row({ id: 'c', transactionDate: '2026-03-06' }), // 31 days
      row({ id: 'd', transactionDate: '2026-04-04' }), // 29 days
    ];
    const series = detectRecurringSeries(rows);
    expect(series).toHaveLength(1);
    expect(series[0]!.cadence).toBe('monthly');
  });

  it('recognises weekly, fortnightly, quarterly and yearly rhythms', () => {
    const dailyRows = (gapDays: number, count: number, amount = '20.00'): RecurringRow[] =>
      Array.from({ length: count }, (_, index) => {
        const date = new Date(Date.UTC(2026, 0, 1 + index * gapDays)).toISOString().slice(0, 10);
        return row({ id: `g${gapDays}-${index}`, transactionDate: date, merchant: 'Gym', description: 'Gym', amount });
      });

    expect(detectRecurringSeries(dailyRows(7, 5))[0]!.cadence).toBe('weekly');
    expect(detectRecurringSeries(dailyRows(14, 4))[0]!.cadence).toBe('fortnightly');
    expect(detectRecurringSeries(dailyRows(91, 3))[0]!.cadence).toBe('quarterly');
    expect(detectRecurringSeries(dailyRows(365, 3))[0]!.cadence).toBe('yearly');
  });

  it('ignores transfers', () => {
    const rows = monthly().map((item) => ({ ...item, type: 'TRANSFER' }));
    expect(detectRecurringSeries(rows)).toHaveLength(0);
  });

  it('groups by amount and normalised name, and orders deterministically', () => {
    const rows = [
      ...monthly('Netflix', '95.00', '2026-01-05', 4),
      ...monthly('Spotify', '30.00', '2026-01-20', 3),
    ];
    const series = detectRecurringSeries(rows);
    expect(series.map((item) => item.name)).toEqual(['Netflix', 'Spotify']);
    expect(series.map((item) => item.seriesKey)).toEqual(['netflix|95.00', 'spotify|30.00']);
  });

  it('uses the merchant when present and the description otherwise', () => {
    const rows = monthly().map((item) => ({ ...item, merchant: null, description: 'Netflix subscription' }));
    const series = detectRecurringSeries(rows);
    expect(series[0]!.name).toBe('Netflix subscription');
    expect(series[0]!.seriesKey).toBe('netflix subscription|95.00');
  });
});
