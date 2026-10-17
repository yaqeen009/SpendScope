import { describe, expect, it } from 'vitest';

import {
  addMonths,
  daysBetweenInclusive,
  daysInMonth,
  endOfMonth,
  isLeapYear,
  isValidDateOnly,
  monthKey,
  monthsBetweenInclusive,
  parseDateOnly,
  startOfMonth,
  toDateOnly,
} from './date.ts';

describe('date-only validation', () => {
  it('accepts valid calendar dates and rejects malformed ones', () => {
    expect(isValidDateOnly('2026-03-01')).toBe(true);
    expect(isValidDateOnly('2026-13-01')).toBe(false);
    expect(isValidDateOnly('2026-02-30')).toBe(false);
    expect(isValidDateOnly('2026-2-1')).toBe(false);
    expect(isValidDateOnly('01/02/2026')).toBe(false);
    expect(isValidDateOnly(20260301)).toBe(false);
  });

  it('handles leap years', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2100)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(isValidDateOnly('2024-02-29')).toBe(true);
    expect(isValidDateOnly('2025-02-29')).toBe(false);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2025, 2)).toBe(28);
  });
});

describe('date-only conversion', () => {
  it('round-trips through UTC without a timezone shift', () => {
    const date = parseDateOnly('2026-01-01');
    expect(date.getUTCHours()).toBe(0);
    expect(toDateOnly(date)).toBe('2026-01-01');
  });

  it('computes month boundaries correctly', () => {
    expect(startOfMonth('2026-02-14')).toBe('2026-02-01');
    expect(endOfMonth('2026-02-14')).toBe('2026-02-28');
    expect(endOfMonth('2024-02-14')).toBe('2024-02-29');
    expect(endOfMonth('2026-12-31')).toBe('2026-12-31');
    expect(monthKey('2026-07-09')).toBe('2026-07');
  });

  it('adds months with day clamping', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-03-15', -1)).toBe('2026-02-15');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
    expect(addMonths('2026-01-15', 12)).toBe('2027-01-15');
  });

  it('counts inclusive days and months across boundaries', () => {
    expect(daysBetweenInclusive('2026-01-01', '2026-01-01')).toBe(1);
    expect(daysBetweenInclusive('2026-01-01', '2026-01-31')).toBe(31);
    expect(daysBetweenInclusive('2024-02-01', '2024-03-01')).toBe(30);
    expect(monthsBetweenInclusive('2026-01-01', '2026-03-31')).toBe(3);
    expect(monthsBetweenInclusive('2025-12-01', '2026-01-31')).toBe(2);
  });
});
