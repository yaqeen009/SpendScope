import { z } from 'zod';

import { SUPPORTED_CURRENCIES } from '../format.ts';
import { PERIOD_KEYS } from '../periods.ts';

export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const updateSettingsSchema = z
  .object({
    currency: z.enum(SUPPORTED_CURRENCIES).optional(),
    locale: z.string().trim().min(2).max(20).optional(),
    theme: z.enum(THEME_PREFERENCES).optional(),
    defaultPeriod: z.enum(PERIOD_KEYS).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
