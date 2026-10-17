import { z } from 'zod';

import { idSchema, moneyStringSchema } from './common.ts';

/** `YYYY-MM` month key. */
export const monthKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/, 'Expected a YYYY-MM month')
  .refine((value) => {
    const month = Number(value.slice(5, 7));
    return month >= 1 && month <= 12;
  }, 'Month must be between 01 and 12');

/**
 * A monthly budget. `categoryId === null` is the single **total monthly
 * expense budget** for that month. A non-null `categoryId` is a category
 * budget. The API enforces at most one total budget and at most one budget per
 * category per month (database partial-unique indexes).
 */
export const createBudgetSchema = z.object({
  month: monthKeySchema,
  amount: moneyStringSchema,
  categoryId: idSchema.nullish(),
});
export type CreateBudgetInput = z.infer<typeof createBudgetSchema>;

export const updateBudgetSchema = z
  .object({
    month: monthKeySchema,
    amount: moneyStringSchema,
    categoryId: idSchema.nullish(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateBudgetInput = z.infer<typeof updateBudgetSchema>;

export const budgetQuerySchema = z.object({
  month: monthKeySchema.optional(),
  from: monthKeySchema.optional(),
  to: monthKeySchema.optional(),
});
export type BudgetQuery = z.infer<typeof budgetQuerySchema>;
