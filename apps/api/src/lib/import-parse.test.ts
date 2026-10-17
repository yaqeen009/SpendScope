import { describe, expect, it } from 'vitest';

import {
  buildCandidateRows,
  buildRecords,
  parseAmountCell,
  parseDateCell,
  parseTypeCell,
  roundToCents,
  summarizeCandidates,
  type ExistingTransactionIndex,
} from './import-parse.ts';

const emptyIndex: ExistingTransactionIndex = { fingerprints: new Map(), byDateAmount: new Map() };

function recordsFrom(csvRows: string[][]): ReturnType<typeof buildRecords>['records'] {
  const [headers, ...rows] = csvRows;
  return buildRecords(headers ?? [], rows).records;
}

describe('parseDateCell', () => {
  it('parses ISO and slashed ISO dates', () => {
    expect(parseDateCell('2026-03-01')).toBe('2026-03-01');
    expect(parseDateCell('2026/03/01')).toBe('2026-03-01');
    expect(parseDateCell('20260301')).toBe('2026-03-01');
    expect(parseDateCell('2026-03-01T10:00:00Z')).toBe('2026-03-01');
  });

  it('parses day-first dates and disambiguates when one part is > 12', () => {
    expect(parseDateCell('25/03/2026')).toBe('2026-03-25');
    expect(parseDateCell('03/25/2026')).toBe('2026-03-25');
    expect(parseDateCell('01/02/2026')).toBe('2026-02-01'); // ambiguous → day-first
    expect(parseDateCell('01-02-26')).toBe('2026-02-01');
  });

  it('accepts unix epoch timestamps', () => {
    expect(parseDateCell('1772323200')).toBe('2026-03-01');
  });

  it('rejects invalid and empty values', () => {
    expect(parseDateCell('')).toBeNull();
    expect(parseDateCell('2026-02-30')).toBeNull();
    expect(parseDateCell('not a date')).toBeNull();
  });
});

describe('roundToCents', () => {
  it('rounds half up to two decimals', () => {
    expect(roundToCents('12.345')).toBe('12.35');
    expect(roundToCents('12.344')).toBe('12.34');
    expect(roundToCents('0.005')).toBe('0.01');
    expect(roundToCents('12')).toBe('12.00');
  });
});

describe('parseAmountCell', () => {
  it('parses plain, signed, symbol-prefixed and thousands-separated values', () => {
    expect(parseAmountCell('312.45')).toEqual({ value: '312.45', negative: false });
    expect(parseAmountCell('-150')).toEqual({ value: '150.00', negative: true });
    expect(parseAmountCell('GH₵ 1,234.50')).toEqual({ value: '1234.50', negative: false });
    expect(parseAmountCell('1.234,50')).not.toBeNull(); // comma removed → 1234.50
  });

  it('treats parentheses as negative (accounting style)', () => {
    expect(parseAmountCell('(250.00)')).toEqual({ value: '250.00', negative: true });
  });

  it('rounds more than two decimals instead of silently truncating', () => {
    expect(parseAmountCell('12.345')).toEqual({ value: '12.35', negative: false });
  });

  it('returns null for empty or malformed values', () => {
    expect(parseAmountCell('')).toBeNull();
    expect(parseAmountCell('abc')).toBeNull();
    expect(parseAmountCell('12.3.4')).toBeNull();
  });
});

describe('parseTypeCell', () => {
  it('maps common aliases onto canonical types', () => {
    expect(parseTypeCell('Debit')).toBe('EXPENSE');
    expect(parseTypeCell('credit')).toBe('INCOME');
    expect(parseTypeCell('DR')).toBe('EXPENSE');
    expect(parseTypeCell('Transfer')).toBe('TRANSFER');
    expect(parseTypeCell('refund')).toBe('REFUND');
    expect(parseTypeCell('unknown-thing')).toBeNull();
    expect(parseTypeCell('')).toBeNull();
  });
});

describe('buildRecords', () => {
  it('zips headers to values and warns on duplicate headers', () => {
    const { records, warnings } = buildRecords(['a', 'b', 'a'], [['1', '2', '3']]);
    expect(records[0]?.values).toEqual({ a: '1', b: '2' });
    expect(warnings.join(' ')).toMatch(/Duplicate column header/);
  });

  it('fills missing cells with an empty string', () => {
    const { records } = buildRecords(['a', 'b'], [['1']]);
    expect(records[0]?.values).toEqual({ a: '1', b: '' });
  });
});

describe('buildCandidateRows', () => {
  const mapping = { date: 'Date', description: 'Description', amount: 'Amount', type: 'Type' } as const;

  it('builds a valid candidate and infers income/expense from the sign', () => {
    const records = recordsFrom([
      ['Date', 'Description', 'Amount'],
      ['2026-03-01', 'Supermarket', '-312.45'],
      ['2026-03-02', 'Salary', '5000.00'],
    ]);
    const candidates = buildCandidateRows({
      records,
      mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
      existing: emptyIndex,
    });
    expect(candidates[0]?.type).toBe('EXPENSE');
    expect(candidates[0]?.amount).toBe('312.45');
    expect(candidates[1]?.type).toBe('INCOME');
    expect(candidates.every((row) => row.status === 'valid')).toBe(true);
  });

  it('uses an explicit type column when present', () => {
    const records = recordsFrom([
      ['Date', 'Description', 'Amount', 'Type'],
      ['2026-03-01', 'Refund', '120.00', 'REFUND'],
    ]);
    const candidates = buildCandidateRows({ records, mapping, existing: emptyIndex });
    expect(candidates[0]?.type).toBe('REFUND');
  });

  it('reads deposit amounts from an optional credit column', () => {
    const records = recordsFrom([
      ['Date', 'Description', 'Debit', 'Credit'],
      ['2026-03-01', 'Groceries', '200.00', ''],
      ['2026-03-02', 'Salary', '', '5000.00'],
    ]);
    const candidates = buildCandidateRows({
      records,
      mapping: { date: 'Date', description: 'Description', amount: 'Debit', credit: 'Credit' },
      existing: emptyIndex,
    });
    expect(candidates[0]).toMatchObject({ amount: '200.00', type: 'EXPENSE' });
    expect(candidates[1]).toMatchObject({ amount: '5000.00', type: 'INCOME' });
  });

  it('reports row-level errors for missing/invalid fields and unsupported types', () => {
    const records = recordsFrom([
      ['Date', 'Description', 'Amount', 'Type'],
      ['', '', 'abc', 'weird'],
    ]);
    const candidates = buildCandidateRows({ records, mapping, existing: emptyIndex });
    expect(candidates[0]?.status).toBe('invalid');
    expect(candidates[0]?.errors).toEqual(
      expect.arrayContaining([
        'Missing transaction date.',
        'Empty description.',
        'Invalid amount "abc".',
        'Unsupported transaction type "weird".',
      ]),
    );
  });

  it('flags exact duplicates that already exist in the database', () => {
    const records = recordsFrom([
      ['Date', 'Description', 'Amount'],
      ['2026-03-01', 'Supermarket', '312.45'],
    ]);
    const fingerprint = buildCandidateRows({
      records,
      mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
      existing: emptyIndex,
    })[0]!.fingerprint!;

    const existing: ExistingTransactionIndex = {
      fingerprints: new Map([[fingerprint, 'existing-id']]),
      byDateAmount: new Map(),
    };
    const candidates = buildCandidateRows({
      records,
      mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
      existing,
    });
    expect(candidates[0]?.status).toBe('duplicate_exact');
    expect(candidates[0]?.duplicateOfId).toBe('existing-id');
  });

  it('flags duplicates inside the same file', () => {
    const records = recordsFrom([
      ['Date', 'Description', 'Amount'],
      ['2026-03-01', 'Supermarket', '312.45'],
      ['2026-03-01', 'Supermarket', '312.45'],
    ]);
    const candidates = buildCandidateRows({
      records,
      mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
      existing: emptyIndex,
    });
    expect(candidates[0]?.status).toBe('valid');
    expect(candidates[1]?.status).toBe('duplicate_exact');
    expect(candidates[1]?.duplicateOfRowIndex).toBe(0);
  });

  it('flags a possible duplicate when date and amount match but wording differs', () => {
    const records = recordsFrom([
      ['Date', 'Description', 'Amount'],
      ['2026-03-01', 'Different wording', '312.45'],
    ]);
    const existing: ExistingTransactionIndex = {
      fingerprints: new Map(),
      byDateAmount: new Map([['2026-03-01|312.45', ['existing-id']]]),
    };
    const candidates = buildCandidateRows({
      records,
      mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
      existing,
    });
    expect(candidates[0]?.status).toBe('duplicate_possible');
    expect(candidates[0]?.duplicateOfId).toBe('existing-id');
  });

  it('suggests a category from rules but only when the file has none', () => {
    const records = recordsFrom([
      ['Date', 'Description', 'Amount'],
      ['2026-03-01', 'Netflix subscription', '95.00'],
    ]);
    const candidates = buildCandidateRows({
      records,
      mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
      existing: emptyIndex,
    });
    expect(candidates[0]?.suggestedCategoryName).toBe('Subscriptions');
    expect(candidates[0]?.categoryName).toBeNull();
  });

  it('summarises counts and uncategorized rows', () => {
    const records = recordsFrom([
      ['Date', 'Description', 'Amount'],
      ['2026-03-01', 'POS PURCHASE 112', '10.00'],
      ['', 'broken', 'x'],
      ['2026-03-02', 'Netflix', '95.00'],
    ]);
    const candidates = buildCandidateRows({
      records,
      mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
      existing: emptyIndex,
    });
    const summary = summarizeCandidates(candidates);
    expect(summary.total).toBe(3);
    expect(summary.invalid).toBe(1);
    expect(summary.valid).toBe(2);
    expect(summary.uncategorized).toBe(1); // POS PURCHASE has no rule and no category column
  });
});
