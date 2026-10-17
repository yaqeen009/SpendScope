import {
  daysInMonth,
  normalizeMoney,
  type CategoryKind,
  type TransactionType,
} from '@spendscope/shared';

import { suggestCategoryName } from './categorize.ts';
import { buildFingerprint } from './fingerprint.ts';

/**
 * Pure CSV → candidate-transaction transformation.
 *
 * This module has no database access: it receives the parsed rows plus an index
 * of already-stored transactions and returns one validated candidate per row.
 * That keeps the tricky date/amount/type parsing fully unit-testable.
 *
 * Row addressing: `rowIndex` is the **0-based index of the data row**, excluding
 * the header. In the original file it is therefore line `rowIndex + 2`. The UI
 * shows `rowIndex + 1` as "record N".
 */

export interface RawCsvRecord {
  rowIndex: number;
  values: Record<string, string>;
}

export interface ExistingTransactionIndex {
  /** fingerprint → stored transaction id. */
  fingerprints: ReadonlyMap<string, string>;
  /** `"YYYY-MM-DD|123.45"` → stored transaction ids with that date and amount. */
  byDateAmount: ReadonlyMap<string, readonly string[]>;
}

export type CandidateStatus = 'valid' | 'invalid' | 'duplicate_exact' | 'duplicate_possible';

export interface CandidateRow {
  rowIndex: number;
  transactionDate: string | null;
  description: string;
  merchant: string | null;
  /** Positive magnitude as a 2-decimal string, or null when unparseable. */
  amount: string | null;
  type: TransactionType | null;
  categoryName: string | null;
  notes: string | null;
  suggestedCategoryName: string | null;
  fingerprint: string | null;
  status: CandidateStatus;
  errors: string[];
  duplicateOfId: string | null;
  /** Set when the duplicate is another row inside the same file. */
  duplicateOfRowIndex: number | null;
}

export interface CandidateSummary {
  total: number;
  valid: number;
  invalid: number;
  duplicatesExact: number;
  duplicatesPossible: number;
  /** Rows that would import without a category and have no suggestion either. */
  uncategorized: number;
}

// ---------------------------------------------------------------------------
// Cell parsers
// ---------------------------------------------------------------------------

function buildDate(year: number, month: number, day: number): string | null {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Parses the date formats commonly found in bank exports.
 *
 * Supported: `YYYY-MM-DD`, `YYYY/MM/DD`, `YYYY.MM.DD`, `YYYYMMDD`, ISO
 * timestamps (`2026-03-01T00:00:00Z`), and `DD/MM/YYYY`-style day-first dates.
 * When day-first and month-first are both plausible (`01/02/2026`) the value is
 * interpreted **day-first**, and this ambiguity is documented in the README.
 */
export function parseDateCell(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  const iso = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:[T ].*)?$/.exec(value);
  if (iso) return buildDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (compact) return buildDate(Number(compact[1]), Number(compact[2]), Number(compact[3]));

  const dayFirst = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(value);
  if (dayFirst) {
    let year = Number(dayFirst[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    const a = Number(dayFirst[1]);
    const b = Number(dayFirst[2]);
    if (a > 12 && b <= 12) return buildDate(year, b, a); // clearly day-first
    if (b > 12 && a <= 12) return buildDate(year, a, b); // clearly month-first
    return buildDate(year, b, a); // ambiguous → day-first (documented)
  }

  if (/^\d{10}$/.test(value)) return isoFromEpoch(Number(value) * 1000);
  if (/^\d{13}$/.test(value)) return isoFromEpoch(Number(value));
  return null;
}

function isoFromEpoch(millis: number): string | null {
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return null;
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  if (y < 1970 || y > 2200) return null;
  return buildDate(y, m, d);
}

export interface ParsedAmount {
  /** Positive magnitude, 2 decimals. */
  value: string;
  negative: boolean;
}

/** Rounds a decimal string to cents using half-up rounding (no floats). */
export function roundToCents(unsigned: string): string {
  const [whole = '0', fraction = ''] = unsigned.split('.');
  const padded = `${fraction}00`;
  let cents = BigInt(whole) * 100n + BigInt(padded.slice(0, 2));
  const remainder = padded.slice(2);
  if (remainder.length > 0 && Number(remainder[0]) >= 5) cents += 1n;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}

/**
 * Parses an amount cell. Handles currency symbols, thousands separators,
 * trailing/leading signs, and accounting-style parentheses for negatives.
 */
export function parseAmountCell(raw: string): ParsedAmount | null {
  let value = raw.trim();
  if (!value) return null;

  let negative = false;
  if (/^\(.*\)$/.test(value)) {
    negative = true;
    value = value.slice(1, -1);
  }

  value = value
    .replace(/[\s\u00a0]/g, '')
    .replace(/[$€£₵¥]/g, '')
    .replace(/[A-Za-z]+/g, '')
    .replace(/,/g, '')
    .replace(/^\+/, '');

  if (value.startsWith('-')) {
    negative = !negative;
    value = value.slice(1);
  }
  if (value.startsWith('-')) return null; // double sign

  if (!/^\d+(\.\d+)?$/.test(value)) return null;

  const rounded = roundToCents(value);
  const normalized = normalizeMoney(rounded);
  if (!normalized) return null;
  return { value: normalized.replace('-', ''), negative };
}

const TYPE_ALIASES: Record<string, TransactionType> = {
  income: 'INCOME',
  credit: 'INCOME',
  cr: 'INCOME',
  deposit: 'INCOME',
  creditin: 'INCOME',
  received: 'INCOME',
  inflow: 'INCOME',
  expense: 'EXPENSE',
  debit: 'EXPENSE',
  dr: 'EXPENSE',
  withdrawal: 'EXPENSE',
  payment: 'EXPENSE',
  spend: 'EXPENSE',
  debitout: 'EXPENSE',
  outflow: 'EXPENSE',
  transfer: 'TRANSFER',
  internaltransfer: 'TRANSFER',
  refund: 'REFUND',
  reversal: 'REFUND',
  chargeback: 'REFUND',
};

/** Maps a free-text type cell onto the canonical transaction type, or null. */
export function parseTypeCell(raw: string): TransactionType | null {
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  if (!key) return null;
  return TYPE_ALIASES[key] ?? null;
}

// ---------------------------------------------------------------------------
// Record mapping
// ---------------------------------------------------------------------------

export interface BuildRecordsResult {
  records: RawCsvRecord[];
  warnings: string[];
}

/** Zips header names with data rows. The first occurrence of a duplicate header wins. */
export function buildRecords(headers: readonly string[], rows: readonly string[][]): BuildRecordsResult {
  const warnings: string[] = [];
  const uniqueHeaders: string[] = [];
  for (const header of headers) {
    if (uniqueHeaders.includes(header)) {
      warnings.push(`Duplicate column header "${header}" — the first column with that name is used.`);
      continue;
    }
    uniqueHeaders.push(header);
  }

  const records: RawCsvRecord[] = rows.map((row, rowIndex) => {
    const values: Record<string, string> = {};
    uniqueHeaders.forEach((header, columnIndex) => {
      values[header] = row[columnIndex] ?? '';
    });
    return { rowIndex, values };
  });

  return { records, warnings };
}

// ---------------------------------------------------------------------------
// Candidate building
// ---------------------------------------------------------------------------

export interface BuildCandidatesOptions {
  records: readonly RawCsvRecord[];
  mapping: {
    date: string;
    description: string;
    amount: string;
    credit?: string | null;
    type?: string | null;
    category?: string | null;
    merchant?: string | null;
    notes?: string | null;
  };
  existing: ExistingTransactionIndex;
}

function cell(record: RawCsvRecord, column: string | null | undefined): string {
  if (!column) return '';
  return (record.values[column] ?? '').trim();
}

export function buildCandidateRows(options: BuildCandidatesOptions): CandidateRow[] {
  const { records, mapping, existing } = options;
  const seenFingerprints = new Map<string, number>();
  const candidates: CandidateRow[] = [];

  for (const record of records) {
    const errors: string[] = [];

    const dateRaw = cell(record, mapping.date);
    const transactionDate = parseDateCell(dateRaw);
    if (!dateRaw) errors.push('Missing transaction date.');
    else if (!transactionDate) errors.push(`Invalid date "${dateRaw}".`);

    const description = cell(record, mapping.description);
    if (!description) errors.push('Empty description.');

    const amountRaw = cell(record, mapping.amount);
    const creditRaw = mapping.credit ? cell(record, mapping.credit) : '';
    let amount: ParsedAmount | null = null;
    /** True when the magnitude came from the optional credit (deposit) column. */
    let amountFromCredit = false;

    if (amountRaw) {
      amount = parseAmountCell(amountRaw);
      if (!amount) errors.push(`Invalid amount "${amountRaw}".`);
    } else if (mapping.credit) {
      if (!creditRaw) {
        errors.push('Missing amount.');
      } else {
        const credit = parseAmountCell(creditRaw);
        if (credit) {
          amount = { value: credit.value, negative: false };
          amountFromCredit = true;
        } else {
          errors.push(`Invalid amount "${creditRaw}".`);
        }
      }
    } else {
      errors.push('Missing amount.');
    }

    let type: TransactionType | null = null;
    const typeRaw = cell(record, mapping.type);
    if (mapping.type && typeRaw) {
      type = parseTypeCell(typeRaw);
      if (!type) errors.push(`Unsupported transaction type "${typeRaw}".`);
    } else if (amount) {
      // No usable type column: infer. A debit/credit pair is directional by
      // itself, so the debit column is an expense and the credit column is
      // income. Otherwise the sign of the amount decides.
      if (amountFromCredit) type = 'INCOME';
      else if (mapping.credit) type = 'EXPENSE';
      else type = amount.negative ? 'EXPENSE' : 'INCOME';
    }

    const categoryName = cell(record, mapping.category) || null;
    const merchantRaw = cell(record, mapping.merchant);
    const merchant = merchantRaw || null;
    const notes = cell(record, mapping.notes) || null;

    let fingerprint: string | null = null;
    let status: CandidateStatus = errors.length > 0 ? 'invalid' : 'valid';
    let duplicateOfId: string | null = null;
    let duplicateOfRowIndex: number | null = null;

    if (status === 'valid' && transactionDate && amount && type) {
      fingerprint = buildFingerprint({
        transactionDate,
        description,
        amount: amount.value,
        type,
        merchant,
      });

      const storedId = existing.fingerprints.get(fingerprint);
      const earlierRow = seenFingerprints.get(fingerprint);
      if (storedId) {
        status = 'duplicate_exact';
        duplicateOfId = storedId;
        errors.push('Identical transaction already exists in the database.');
      } else if (earlierRow !== undefined) {
        status = 'duplicate_exact';
        duplicateOfRowIndex = earlierRow;
        errors.push(`Identical to record ${earlierRow + 1} earlier in this file.`);
      } else {
        seenFingerprints.set(fingerprint, record.rowIndex);
        const sameDateAmount = existing.byDateAmount.get(`${transactionDate}|${amount.value}`);
        if (sameDateAmount && sameDateAmount.length > 0) {
          status = 'duplicate_possible';
          duplicateOfId = sameDateAmount[0] ?? null;
        }
      }
    }

    // Suggestions only follow the income/expense split when the file states the
    // type explicitly. When the type was inferred from an unsigned amount that
    // direction is a guess, so both rule sets are considered.
    const explicitType = mapping.type && typeRaw ? type : null;
    const suggestion =
      categoryName === null
        ? suggestCategoryName({ description, merchant, type: explicitType })
        : null;

    candidates.push({
      rowIndex: record.rowIndex,
      transactionDate,
      description,
      merchant,
      amount: amount ? amount.value : null,
      type,
      categoryName,
      notes,
      suggestedCategoryName: suggestion,
      fingerprint,
      status,
      errors,
      duplicateOfId,
      duplicateOfRowIndex,
    });
  }

  return candidates;
}

export function summarizeCandidates(candidates: readonly CandidateRow[]): CandidateSummary {
  let valid = 0;
  let invalid = 0;
  let duplicatesExact = 0;
  let duplicatesPossible = 0;
  let uncategorized = 0;

  for (const candidate of candidates) {
    if (candidate.status === 'invalid') {
      invalid += 1;
      // Invalid rows are never imported, so they are not counted as uncategorized.
      continue;
    }
    if (candidate.status === 'duplicate_exact') duplicatesExact += 1;
    else if (candidate.status === 'duplicate_possible') duplicatesPossible += 1;
    else valid += 1;

    if (!candidate.categoryName && !candidate.suggestedCategoryName) uncategorized += 1;
  }

  return {
    total: candidates.length,
    valid,
    invalid,
    duplicatesExact,
    duplicatesPossible,
    uncategorized,
  };
}

/** Category kind implied by a transaction type (used to match categories by name). */
export function kindForType(type: TransactionType): CategoryKind {
  return type === 'INCOME' ? 'INCOME' : 'EXPENSE';
}
