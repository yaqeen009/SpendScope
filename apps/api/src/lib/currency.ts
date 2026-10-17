import { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES } from '@spendscope/shared';

import { BadRequestError } from './errors.ts';
import { prisma } from './prisma.ts';

/**
 * Currency handling.
 *
 * SpendScope is **single-currency per total**. There is no conversion anywhere in
 * the codebase, and that is deliberate: a wrong or stale rate would corrupt every
 * figure with no visible failure.
 *
 * The model is therefore:
 *
 *  - Each workspace has a **base currency** (`Settings.currency`).
 *  - A transaction is either in the base currency (`currency IS NULL`, the normal
 *    case, and what every pre-existing row is) or in an explicitly named foreign
 *    currency.
 *  - Aggregates filter to `currency IS NULL`, and the analytics summary reports
 *    the excluded rows separately, so a total can never silently mix currencies.
 *
 * Base-currency rows store `NULL` rather than the code itself, so a workspace can
 * change its base currency without rewriting history and the aggregate filter
 * stays a single, cheap predicate.
 */

export const SUPPORTED = SUPPORTED_CURRENCIES;

/** The workspace base currency, defaulting to the shared default. */
export async function baseCurrency(workspaceId: string): Promise<string> {
  const settings = await prisma.settings.findUnique({
    where: { workspaceId },
    select: { currency: true },
  });
  return settings?.currency ?? DEFAULT_CURRENCY;
}

export function assertSupportedCurrency(currency: string): void {
  if (!(SUPPORTED as readonly string[]).includes(currency)) {
    throw new BadRequestError(`Unsupported currency "${currency}"`, { supported: [...SUPPORTED] });
  }
}

/**
 * Maps a requested currency onto the stored form: `null` when it is the base
 * currency, otherwise the code.
 */
export function normalizeCurrency(requested: string | null | undefined, base: string): string | null {
  if (requested === null || requested === undefined) return null;
  assertSupportedCurrency(requested);
  return requested === base ? null : requested;
}

/** Human-readable code for a stored value. */
export function displayCurrency(stored: string | null, base: string): string {
  return stored ?? base;
}
