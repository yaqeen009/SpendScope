import { z } from 'zod';

import { CATEGORY_KINDS, IMPORT_STATUSES, REVIEW_STATUSES, TRANSACTION_TYPES } from '../enums.ts';
import { MONEY_PATTERN } from '../money.ts';

/** `YYYY-MM-DD` with a real calendar check (leap years included). */
export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date')
  .refine(
    (value) => {
      const [y, m, d] = value.split('-').map(Number) as [number, number, number];
      if (m < 1 || m > 12) return false;
      const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
      return d >= 1 && d <= daysInMonth;
    },
    { message: 'Not a valid calendar date' },
  );

/** Non-negative decimal money string with at most two decimal places. */
export const moneyStringSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, 'Expected a positive amount such as "1234.50"')
  .refine((value) => Number(value) <= 9_999_999_999_999, {
    message: 'Amount exceeds the maximum supported value',
  });

/** Decimal money string that may be negative (used for signed import columns). */
export const signedMoneyStringSchema = z
  .string()
  .trim()
  .regex(MONEY_PATTERN, 'Expected a decimal amount such as "-1234.50"');

export const transactionTypeSchema = z.enum(TRANSACTION_TYPES);
export const reviewStatusSchema = z.enum(REVIEW_STATUSES);
export const categoryKindSchema = z.enum(CATEGORY_KINDS);
export const importStatusSchema = z.enum(IMPORT_STATUSES);

export const sortOrderSchema = z.enum(['asc', 'desc']);

/** Keyset-free offset pagination with a guarded page size. */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const idSchema = z.string().uuid('Expected a UUID');
