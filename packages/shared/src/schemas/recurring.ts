import { z } from 'zod';

/**
 * Recurring-transaction detection and dismissals.
 *
 * Detection is read-only and heuristic. A dismissal only hides a series from the
 * default response; it never deletes or modifies transactions.
 */

export const recurringQuerySchema = z.object({
  /** Include series the user has dismissed. Defaults to false. */
  includeDismissed: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .optional(),
  /** How far back to look, in months. */
  months: z.coerce.number().int().min(3).max(120).default(18),
});
export type RecurringQuery = z.infer<typeof recurringQuerySchema>;

export const dismissRecurringSchema = z.object({
  /** `seriesKey` from a previous detection response. */
  seriesKey: z.string().trim().min(1).max(400),
  name: z.string().trim().min(1).max(200),
  reason: z.string().trim().max(500).nullish(),
});
export type DismissRecurringInput = z.infer<typeof dismissRecurringSchema>;
