import { describe, expect, it } from 'vitest';

import {
  granularityForRange,
  isFullMonthRange,
  previousPeriod,
  rangeContains,
  resolvePeriod,
} from './periods.ts';

const TODAY = '2026-03-15';

describe('resolvePeriod', () => {
  it('resolves this month with inclusive bounds', () => {
    const period = resolvePeriod({ key: 'this_month', today: TODAY });
    expect(period.start).toBe('2026-03-01');
    expect(period.end).toBe('2026-03-31');
  });

  it('resolves last month across a year boundary', () => {
    const period = resolvePeriod({ key: 'last_month', today: '2026-01-10' });
    expect(period.start).toBe('2025-12-01');
    expect(period.end).toBe('2025-12-31');
  });

  it('resolves last three months including the current month', () => {
    const period = resolvePeriod({ key: 'last_3_months', today: TODAY });
    expect(period.start).toBe('2026-01-01');
    expect(period.end).toBe('2026-03-31');
  });

  it('resolves this year to January–December', () => {
    const period = resolvePeriod({ key: 'this_year', today: TODAY });
    expect(period.start).toBe('2026-01-01');
    expect(period.end).toBe('2026-12-31');
  });

  it('normalises a reversed custom range', () => {
    const period = resolvePeriod({ key: 'custom', from: '2026-03-31', to: '2026-03-01', today: TODAY });
    expect(period.start).toBe('2026-03-01');
    expect(period.end).toBe('2026-03-31');
  });
});

describe('previousPeriod', () => {
  it('shifts a month-aligned range back by whole months (Feb vs Mar)', () => {
    expect(previousPeriod({ start: '2026-03-01', end: '2026-03-31' })).toEqual({
      start: '2026-02-01',
      end: '2026-02-28',
    });
  });

  it('same-length comparison across a year boundary for a full year', () => {
    expect(previousPeriod({ start: '2026-01-01', end: '2026-12-31' })).toEqual({
      start: '2025-01-01',
      end: '2025-12-31',
    });
  });

  it('shifts a non month-aligned range back by its day count', () => {
    expect(previousPeriod({ start: '2026-03-05', end: '2026-03-14' })).toEqual({
      start: '2026-02-23',
      end: '2026-03-04',
    });
  });

  it('keeps a single-day range one day long', () => {
    expect(previousPeriod({ start: '2026-03-05', end: '2026-03-05' })).toEqual({
      start: '2026-03-04',
      end: '2026-03-04',
    });
  });
});

describe('granularityForRange', () => {
  it('uses days for short ranges, weeks for medium, months for long', () => {
    expect(granularityForRange({ start: '2026-03-01', end: '2026-03-31' })).toBe('day');
    expect(granularityForRange({ start: '2026-01-01', end: '2026-04-15' })).toBe('week');
    expect(granularityForRange({ start: '2026-01-01', end: '2026-12-31' })).toBe('month');
  });
});

describe('range helpers', () => {
  it('detects membership inclusively', () => {
    const range = { start: '2026-03-01', end: '2026-03-31' };
    expect(rangeContains(range, '2026-03-01')).toBe(true);
    expect(rangeContains(range, '2026-03-31')).toBe(true);
    expect(rangeContains(range, '2026-02-28')).toBe(false);
    expect(rangeContains(range, '2026-04-01')).toBe(false);
  });

  it('detects full-month ranges', () => {
    expect(isFullMonthRange({ start: '2026-02-01', end: '2026-02-28' })).toBe(true);
    expect(isFullMonthRange({ start: '2026-02-01', end: '2026-02-27' })).toBe(false);
  });
});
