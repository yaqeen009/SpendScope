import { z } from 'zod';

import { dateOnlySchema } from './common.ts';
import { PERIOD_KEYS } from '../periods.ts';

/** Query-string boolean that accepts `true`/`1`/`yes` and `false`/`0`/`no`. */
const booleanish = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;
  }
  return value;
}, z.boolean());

export const analyticsQuerySchema = z.object({
  period: z.enum(PERIOD_KEYS).default('this_month'),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  compare: booleanish.default(true),
  recentLimit: z.coerce.number().int().min(1).max(50).default(8),
});
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
