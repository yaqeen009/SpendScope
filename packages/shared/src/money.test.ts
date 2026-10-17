import { describe, expect, it } from 'vitest';

import {
  absMoney,
  addMoney,
  compareMoney,
  fromMinorUnits,
  isMoneyString,
  isZeroMoney,
  normalizeMoney,
  percentChange,
  sanitizeMoneyInput,
  savingsRateFraction,
  subtractMoney,
  toMinorUnits,
} from './money.ts';

describe('money parsing', () => {
  it('accepts plain and signed decimals with up to two places', () => {
    expect(isMoneyString('0')).toBe(true);
    expect(isMoneyString('12.5')).toBe(true);
    expect(isMoneyString('12.50')).toBe(true);
    expect(isMoneyString('-3.00')).toBe(true);
    expect(isMoneyString('12.345')).toBe(false);
    expect(isMoneyString('12,50')).toBe(false);
    expect(isMoneyString('abc')).toBe(false);
    expect(isMoneyString('')).toBe(false);
  });

  it('strips currency symbols and thousands separators', () => {
    expect(sanitizeMoneyInput('GH₵ 1,234.50')).toBe('1234.50');
    expect(sanitizeMoneyInput('$1,000')).toBe('1000');
  });

  it('normalises to two decimals without floating point error', () => {
    expect(normalizeMoney('1,234.5')).toBe('1234.50');
    expect(normalizeMoney('0.1')).toBe('0.10');
    expect(normalizeMoney('nonsense')).toBeNull();
  });

  it('round-trips minor units exactly', () => {
    expect(toMinorUnits('10.10')).toBe(1010n);
    expect(toMinorUnits('-0.05')).toBe(-5n);
    expect(fromMinorUnits(1010n)).toBe('10.10');
    expect(fromMinorUnits(-5n)).toBe('-0.05');
  });

  it('adds decimals exactly (0.1 + 0.2 === 0.30)', () => {
    expect(addMoney('0.10', '0.20')).toBe('0.30');
    expect(subtractMoney('100.00', '33.33')).toBe('66.67');
    expect(absMoney('-12.34')).toBe('12.34');
    expect(compareMoney('1.00', '1.01')).toBe(-1);
    expect(compareMoney('1.01', '1.00')).toBe(1);
    expect(compareMoney('1.00', '1.00')).toBe(0);
    expect(isZeroMoney('0.00')).toBe(true);
  });

  it('handles very large values without precision loss', () => {
    expect(addMoney('9999999.99', '0.01')).toBe('10000000.00');
  });
});

describe('savingsRateFraction', () => {
  it('returns null when income is zero or negative rather than Infinity/NaN', () => {
    expect(savingsRateFraction('100.00', '0.00')).toBeNull();
    expect(savingsRateFraction('100.00', '-10.00')).toBeNull();
  });

  it('computes net/income for positive income', () => {
    expect(savingsRateFraction('250.00', '1000.00')).toBeCloseTo(0.25, 10);
    expect(savingsRateFraction('-250.00', '1000.00')).toBeCloseTo(-0.25, 10);
  });
});

describe('percentChange', () => {
  it('returns null when the previous value is zero (no division by zero)', () => {
    expect(percentChange('100.00', '0.00')).toBeNull();
  });

  it('computes the relative change', () => {
    expect(percentChange('150.00', '100.00')).toBeCloseTo(0.5, 10);
    expect(percentChange('50.00', '100.00')).toBeCloseTo(-0.5, 10);
  });
});
