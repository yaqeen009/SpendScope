/**
 * Money handling.
 *
 * Convention (documented in docs/DATA_MODEL.md):
 *   - Monetary values are always stored as a **positive magnitude** in
 *     PostgreSQL `DECIMAL(14,2)` together with an explicit transaction type.
 *     The database never stores signed amounts.
 *   - On the wire (JSON) amounts are transported as decimal **strings**
 *     (`"1234.50"`), never as JavaScript floats, so no precision is lost.
 *   - Arithmetic in this module converts to integer **minor units** (BigInt)
 *     before adding or comparing, so it is exact.
 */

/** Accepts optional sign, digits, and up to two decimal places. */
export const MONEY_PATTERN = /^[+-]?\d+(\.\d{1,2})?$/;

/** Strips currency symbols (letters or glyphs), thousands separators and whitespace. */
export function sanitizeMoneyInput(raw: string): string {
  return raw
    .trim()
    .replace(/[\s\u00a0]/g, '')
    .replace(/[$€£₵¥]/g, '')
    // Currency codes and stray letters (GHS, USD, GH₵, â€¦) are noise for parsing.
    .replace(/[A-Za-z]+/g, '')
    .replace(/,/g, '');
}

export function isMoneyString(value: unknown): value is string {
  return typeof value === 'string' && MONEY_PATTERN.test(value.trim());
}

/** Parses a decimal string into minor units (cents). Throws on malformed input. */
export function toMinorUnits(value: string): bigint {
  const trimmed = value.trim();
  if (!MONEY_PATTERN.test(trimmed)) {
    throw new RangeError(`Invalid money string: ${String(value)}`);
  }
  const negative = trimmed.startsWith('-');
  const unsigned = trimmed.replace(/^[+-]/, '');
  const [whole, fraction = ''] = unsigned.split('.');
  const cents = `${fraction}00`.slice(0, 2);
  const magnitude = BigInt(whole ?? '0') * 100n + BigInt(cents === '' ? '0' : cents);
  return negative ? -magnitude : magnitude;
}

/** Formats minor units back into a canonical 2-decimal string. */
export function fromMinorUnits(minor: bigint): string {
  const negative = minor < 0n;
  const magnitude = negative ? -minor : minor;
  const whole = magnitude / 100n;
  const cents = magnitude % 100n;
  return `${negative ? '-' : ''}${whole}.${cents.toString().padStart(2, '0')}`;
}

/** Normalises any accepted input into a 2-decimal string, or returns null. */
export function normalizeMoney(value: string): string | null {
  try {
    return fromMinorUnits(toMinorUnits(sanitizeMoneyInput(value)));
  } catch {
    return null;
  }
}

/** Absolute value of a money string. */
export function absMoney(value: string): string {
  return fromMinorUnits(absMinor(value));
}

export function absMinor(value: string): bigint {
  const minor = toMinorUnits(value);
  return minor < 0n ? -minor : minor;
}

export function addMoney(a: string, b: string): string {
  return fromMinorUnits(toMinorUnits(a) + toMinorUnits(b));
}

export function subtractMoney(a: string, b: string): string {
  return fromMinorUnits(toMinorUnits(a) - toMinorUnits(b));
}

export function compareMoney(a: string, b: string): number {
  const am = toMinorUnits(a);
  const bm = toMinorUnits(b);
  return am < bm ? -1 : am > bm ? 1 : 0;
}

export function isZeroMoney(value: string): boolean {
  return toMinorUnits(value) === 0n;
}

/**
 * Savings rate = net cash flow / income, expressed as a fraction.
 * Returns `null` when income is not positive so callers can render an
 * "unavailable" state instead of `NaN`/`Infinity`.
 */
export function savingsRateFraction(net: string, income: string): number | null {
  const incomeMinor = toMinorUnits(income);
  if (incomeMinor <= 0n) return null;
  return Number(toMinorUnits(net)) / Number(incomeMinor);
}

/**
 * Percentage change between two periods. Returns `null` when the previous
 * value is zero (there is no meaningful percentage) so callers never divide
 * by zero.
 */
export function percentChange(current: string, previous: string): number | null {
  const previousMinor = toMinorUnits(previous);
  if (previousMinor === 0n) return null;
  const delta = Number(toMinorUnits(current) - previousMinor);
  return delta / Number(previousMinor);
}
