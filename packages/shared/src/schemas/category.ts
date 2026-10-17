import { z } from 'zod';

import { categoryKindSchema, idSchema } from './common.ts';

const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Expected a hex colour such as "#16a34a"');

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60),
  kind: categoryKindSchema,
  color: hexColorSchema.nullish(),
  description: z.string().trim().max(300).nullish(),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = createCategorySchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'At least one field must be provided' },
);
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

/**
 * Deleting a category that still has transactions is refused unless the caller
 * explicitly chooses a strategy. `reassignTo` moves the transactions to another
 * category; `uncategorize` (or omitting both) sets them to `null`.
 */
export const deleteCategoryQuerySchema = z.object({
  strategy: z.enum(['reassign', 'uncategorize', 'block']).default('block'),
  reassignTo: idSchema.optional(),
});
export type DeleteCategoryQuery = z.infer<typeof deleteCategoryQuerySchema>;
