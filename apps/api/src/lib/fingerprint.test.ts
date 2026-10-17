import { describe, expect, it } from 'vitest';

import { buildFingerprint, normalizeMerchant, normalizeText } from './fingerprint.ts';

describe('normalizeText', () => {
  it('lower-cases, strips punctuation and collapses whitespace', () => {
    expect(normalizeText('  ShopRite   SUPERMARKET! ')).toBe('shoprite supermarket');
    expect(normalizeText('Café  déjà-vu')).toBe('cafe deja vu');
    expect(normalizeText('')).toBe('');
  });
});

describe('normalizeMerchant', () => {
  it('returns null for empty input', () => {
    expect(normalizeMerchant(null)).toBeNull();
    expect(normalizeMerchant('   ')).toBeNull();
    expect(normalizeMerchant('ShopRite')).toBe('shoprite');
  });
});

describe('buildFingerprint', () => {
  const base = {
    transactionDate: '2026-03-01',
    description: 'Supermarket shopping',
    amount: '312.45',
    type: 'EXPENSE',
    merchant: 'ShopRite',
  };

  it('is deterministic', () => {
    expect(buildFingerprint(base)).toBe(buildFingerprint(base));
  });

  it('ignores case, punctuation and spacing differences in text', () => {
    expect(buildFingerprint(base)).toBe(
      buildFingerprint({ ...base, description: ' supermarket   SHOPPING! ', merchant: 'shoprite' }),
    );
  });

  it('treats 12.5 and 12.50 as the same amount', () => {
    expect(buildFingerprint({ ...base, amount: '12.5' })).toBe(
      buildFingerprint({ ...base, amount: '12.50' }),
    );
  });

  it('differs when date, amount, type or merchant differ', () => {
    expect(buildFingerprint(base)).not.toBe(buildFingerprint({ ...base, transactionDate: '2026-03-02' }));
    expect(buildFingerprint(base)).not.toBe(buildFingerprint({ ...base, amount: '312.46' }));
    expect(buildFingerprint(base)).not.toBe(buildFingerprint({ ...base, type: 'REFUND' }));
    expect(buildFingerprint(base)).not.toBe(buildFingerprint({ ...base, merchant: 'Melcom' }));
  });

  it('produces a sha-256 hex digest', () => {
    expect(buildFingerprint(base)).toMatch(/^[0-9a-f]{64}$/);
  });
});
