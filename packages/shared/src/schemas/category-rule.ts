import { z } from 'zod';

import { RULE_MATCH_FIELDS } from '../enums.ts';
import { idSchema } from './common.ts';

/**
 * Category rules fill in a category for rows that have none.
 *
 * A rule is a case-insensitive substring test against the description, the
 * merchant, or either. Rules never replace a category that is already set, and
 * ordering is deterministic so the same data always yields the same result.
 */

/** Substring that is matched case-insensitively; normalised on the server. */
const patternSchema = z
  .string()
  .trim()
  .min(2, 'A pattern must be at least 2 characters')
  .max(120, 'A pattern must be 120 characters or fewer');

export const createCategoryRuleSchema = z.object({
  matchField: z.enum(RULE_MATCH_FIELDS),
  pattern: patternSchema,
  categoryId: idSchema,
  /**
   * Lower numbers take precedence. Defaults to 100 so rules are ordered by the
   * order they were created until the user reorders them.
   */
  priority: z.number().int().min(0).max(10_000).optional(),
  isActive: z.boolean().optional(),
});
export type CreateCategoryRuleInput = z.infer<typeof createCategoryRuleSchema>;

export const updateCategoryRuleSchema = createCategoryRuleSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field must be provided' });
export type UpdateCategoryRuleInput = z.infer<typeof updateCategoryRuleSchema>;

/**
 * Retroactive application. `dryRun` defaults to **true**: a caller must opt in
 * to actually changing rows.
 */
export const applyCategoryRulesSchema = z.object({
  dryRun: z.boolean().optional(),
  /** Also re-evaluate rows that were already reviewed. Off by default. */
  includeReviewed: z.boolean().optional(),
});
export type ApplyCategoryRulesInput = z.infer<typeof applyCategoryRulesSchema>;
