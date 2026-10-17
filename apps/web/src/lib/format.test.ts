import { describe, expect, it } from 'vitest';

import { formatBytes, formatChange, pluralise } from '@/lib/format';

describe('formatChange', () => {
  it('prefixes a positive fraction with a plus sign', () => {
    expect(formatChange(0.1234)).toBe('+12.3%');
  });

  it('keeps the negative sign for a decrease', () => {
    expect(formatChange(-0.05)).toBe('-5.0%');
  });

  it('renders an em dash when the change is undefined or not finite', () => {
    expect(formatChange(null)).toBe('—');
    expect(formatChange(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('pluralise', () => {
  it('uses the singular form for one', () => {
    expect(pluralise(1, 'transaction')).toBe('1 transaction');
  });

  it('uses the plural form for zero and many', () => {
    expect(pluralise(0, 'transaction')).toBe('0 transactions');
    expect(pluralise(3, 'transaction')).toBe('3 transactions');
  });

  it('accepts an irregular plural', () => {
    expect(pluralise(2, 'import batch', 'import batches')).toBe('2 import batches');
  });
});

describe('formatBytes', () => {
  it('renders bytes, kilobytes and megabytes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB');
  });

  it('renders an em dash for invalid input', () => {
    expect(formatBytes(Number.NaN)).toBe('—');
    expect(formatBytes(-1)).toBe('—');
  });
});
