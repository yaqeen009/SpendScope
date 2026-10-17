import { z } from 'zod';

import {
  dateOnlySchema,
  idSchema,
  moneyStringSchema,
  paginationSchema,
  reviewStatusSchema,
  sortOrderSchema,
  transactionTypeSchema,
} from './common.ts';
import { SUPPORTED_CURRENCIES } from '../format.ts';

/** Splits a comma-separated query value (`type=EXPENSE,REFUND`) into an array. */
const commaList = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess(
    (value) =>
      typeof value === 'string'
        ? value
            .split(',')
            .map((part) => part.trim())
            .filter((part) => part.length > 0)
        : value,
    z.array(item),
  );

export const createTransactionSchema = z.object({
  transactionDate: dateOnlySchema,
  description: z.string().trim().min(1, 'Description is required').max(500),
  merchant: z.string().trim().max(200).nullish(),
  amount: moneyStringSchema,
  type: transactionTypeSchema,
  categoryId: idSchema.nullish(),
  notes: z.string().trim().max(2000).nullish(),
  reviewStatus: reviewStatusSchema.optional(),
  /**
   * REFUND rows only: the EXPENSE this refund reverses. The server verifies the
   * original belongs to the same workspace, and copies its category so the
   * refund reduces spending in the right category.
   */
  refundOfTransactionId: idSchema.nullish(),
  /**
   * ISO-4217 code for `amount`. Omit it (or send the workspace base currency)
   * for a normal row. A **foreign** currency is stored and displayed, but the row
   * is excluded from every aggregated total because no conversion is performed.
   */
  currency: z.enum(SUPPORTED_CURRENCIES).nullish(),
});
export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;

export const updateTransactionSchema = createTransactionSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'At least one field must be provided' },
);
export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;

/** Pairs two existing TRANSFER rows as the two sides of one movement. */
export const linkTransferSchema = z.object({
  counterpartId: idSchema,
});
export type LinkTransferInput = z.infer<typeof linkTransferSchema>;

export const SORTABLE_TRANSACTION_FIELDS = ['date', 'amount', 'description'] as const;

export const transactionQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  categoryId: z
    .union([idSchema, z.literal('uncategorized')])
    .optional(),
  type: commaList(transactionTypeSchema).optional(),
  reviewStatus: reviewStatusSchema.optional(),
  importBatchId: idSchema.optional(),
  /** Restrict to one currency, or `base` for the workspace base currency. */
  currency: z.union([z.enum(SUPPORTED_CURRENCIES), z.literal('base')]).optional(),
  minAmount: moneyStringSchema.optional(),
  maxAmount: moneyStringSchema.optional(),
  sortBy: z.enum(SORTABLE_TRANSACTION_FIELDS).default('date'),
  sortOrder: sortOrderSchema.default('desc'),
});
export type TransactionQuery = z.infer<typeof transactionQuerySchema>;
