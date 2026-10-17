import { createHash } from 'node:crypto';

/**
 * Duplicate detection is fingerprint-based and therefore *heuristic*.
 *
 * A fingerprint is the SHA-256 hash of:
 *   transactionDate | normalised description | amount | type | normalised merchant
 *
 * An identical fingerprint means "these two rows describe the same movement of
 * money with the same wording" — an **exact duplicate**. It deliberately does
 * not catch:
 *   - the same purchase reworded by a different bank export,
 *   - legitimate repeated transactions with identical wording and amount
 *     (e.g. two identical coffees on the same day), which are *not* duplicates.
 *
 * Those cases are surfaced separately as **possible duplicates** (same date and
 * amount, different wording) and left for the user to decide.
 */

/** Lower-cases, strips punctuation and collapses whitespace. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export interface FingerprintInput {
  transactionDate: string;
  description: string;
  amount: string;
  type: string;
  merchant?: string | null;
}

export function buildFingerprint(input: FingerprintInput): string {
  const payload = [
    input.transactionDate,
    normalizeText(input.description),
    normalizeMoneyForHash(input.amount),
    input.type.toUpperCase(),
    normalizeText(input.merchant ?? ''),
  ].join('|');
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

/** Normalises `"12.5"` and `"12.50"` to the same hash input. */
function normalizeMoneyForHash(amount: string): string {
  const parsed = Number.parseFloat(amount.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed.toFixed(2) : amount.trim();
}

export function normalizeMerchant(merchant: string | null | undefined): string | null {
  if (!merchant) return null;
  const normalized = normalizeText(merchant);
  return normalized.length > 0 ? normalized : null;
}
