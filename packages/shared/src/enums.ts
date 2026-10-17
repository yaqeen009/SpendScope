/**
 * Canonical enums shared by the API and the web client.
 *
 * These are declared as `const` tuples (not TypeScript enums) so they can be
 * used directly with Zod, iterated at runtime in the browser, and serialised
 * over the wire without transformation.
 *
 * The Prisma schema declares the matching PostgreSQL enum types; the string
 * values are identical to the Prisma-generated names.
 */

export const TRANSACTION_TYPES = ['INCOME', 'EXPENSE', 'TRANSFER', 'REFUND'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const REVIEW_STATUSES = ['NEEDS_REVIEW', 'REVIEWED'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const CATEGORY_KINDS = ['INCOME', 'EXPENSE'] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

export const IMPORT_STATUSES = ['COMPLETED', 'PARTIAL', 'FAILED'] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

/**
 * The set of transaction types that contribute to the *expense* side of the
 * financial summaries. `REFUND` is treated as a negative expense (money coming
 * back for a previous expense) rather than as income; `TRANSFER` is excluded
 * from both income and expenses.
 */
export const EXPENSE_LIKE_TYPES: readonly TransactionType[] = ['EXPENSE', 'REFUND'];

/** The set of transaction types that contribute to the *income* side. */
export const INCOME_LIKE_TYPES: readonly TransactionType[] = ['INCOME'];

/** Transaction types that are deliberately excluded from cash-flow totals. */
export const EXCLUDED_FROM_TOTALS_TYPES: readonly TransactionType[] = ['TRANSFER'];

/**
 * Account-level transfer tracking is out of scope for this release: the app
 * cannot reliably detect a transfer between a user's own accounts. Transfers
 * are therefore stored but excluded from income/expense/budget calculations, and
 * this limitation is surfaced in the UI and documentation.
 */
export const TRANSFER_SUPPORT_NOTE =
  'Transfers are excluded from income, expense and budget totals. Automatic transfer detection between accounts is not implemented in this release.';
