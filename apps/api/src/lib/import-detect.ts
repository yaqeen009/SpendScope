import type { ImportTargetField, PartialColumnMapping } from '@spendscope/shared';

/**
 * Best-effort header → field detection for the import wizard. This only
 * *suggests* a mapping; the user confirms or corrects every column before the
 * file is validated. It never guesses silently.
 */

const PRIORITY: readonly ImportTargetField[] = [
  'date',
  'description',
  'amount',
  'credit',
  'type',
  'category',
  'merchant',
  'notes',
];

const PATTERNS: Record<ImportTargetField, readonly RegExp[]> = {
  date: [/^date$/i, /transaction\s*date/i, /value\s*date/i, /^posted/i, /posting\s*date/i, /^time$/i, /date/i],
  description: [
    /^description$/i,
    /^details?$/i,
    /narrative/i,
    /particulars/i,
    /^memo$/i,
    /^payee$/i,
    /^reference$/i,
    /^transaction$/i,
    /description/i,
  ],
  amount: [/^amount$/i, /^value$/i, /^debit$/i, /withdrawal/i, /^sum$/i, /^total$/i, /amount/i],
  credit: [/^credit$/i, /deposit/i, /^money\s*in$/i, /inflow/i],
  type: [/^type$/i, /^cr\/?dr$/i, /debit\s*\/?\s*credit/i, /transaction\s*type/i, /^dr\/?cr$/i],
  category: [/category/i],
  merchant: [/merchant/i, /counterparty/i, /^vendor$/i, /^payee$/i],
  notes: [/^notes?$/i, /comment/i, /^memo$/i],
};

export interface HeaderDetectionResult {
  mapping: PartialColumnMapping;
  /** Field → header name confidence is not modelled; detection is a plain match. */
  matched: ImportTargetField[];
}

export function detectMapping(headers: readonly string[]): HeaderDetectionResult {
  const used = new Set<string>();
  const mapping: PartialColumnMapping = {};
  const matched: ImportTargetField[] = [];

  for (const field of PRIORITY) {
    for (const pattern of PATTERNS[field]) {
      const found = headers.find((header) => !used.has(header) && pattern.test(header.trim()));
      if (found) {
        used.add(found);
        mapping[field] = found;
        matched.push(field);
        break;
      }
    }
  }

  return { mapping, matched };
}
