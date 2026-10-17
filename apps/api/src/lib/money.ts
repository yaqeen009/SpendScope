import { Prisma } from '../generated/prisma/client.ts';

/** Prisma `Decimal` re-exported so the rest of the API imports money types from one place. */
export type Decimal = Prisma.Decimal;
export const Decimal = Prisma.Decimal;

/** Formats a Prisma Decimal (or null) as a canonical 2-decimal string. */
export function decimalToString(value: Prisma.Decimal | null | undefined): string {
  if (value === null || value === undefined) return '0.00';
  return value.toFixed(2);
}

/** Parses a validated money string into a Prisma Decimal. */
export function stringToDecimal(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

export function sumDecimals(values: readonly Prisma.Decimal[]): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>((total, value) => total.plus(value), new Prisma.Decimal(0));
}

export function isZeroDecimal(value: Prisma.Decimal): boolean {
  return value.isZero();
}

/** Percentage of `spent` against `budget`, as a fraction. Budget 0 → 0 (never Infinity). */
export function usageFraction(spent: Prisma.Decimal, budget: Prisma.Decimal): number {
  if (budget.lte(0)) return 0;
  return spent.div(budget).toNumber();
}

/**
 * Budget state thresholds (documented in docs/FINANCIAL_RULES.md):
 *   percentUsed < 80%   → ok
 *   80% <= used <= 100% → warning
 *   used > 100%         → exceeded
 */
export function budgetState(percentUsed: number): 'ok' | 'warning' | 'exceeded' {
  if (percentUsed > 1) return 'exceeded';
  if (percentUsed >= 0.8) return 'warning';
  return 'ok';
}
