import { useMemo } from 'react';

import { FALLBACK_CURRENCY, FALLBACK_LOCALE, formatCurrency, formatCurrencyCompact, formatDateOnly, formatMonthKey, formatPercent } from '@/lib/format';
import { useSettings } from '@/features/settings/queries';

/**
 * Formatting bound to the user's currency and locale settings.
 *
 * The currency setting is **display-only**: `formatMoney` re-formats the stored
 * amount and never converts it. See docs/DECISIONS.md.
 */
export function useMoney() {
  const { data: settings } = useSettings();
  const currency = settings?.currency ?? FALLBACK_CURRENCY;
  const locale = settings?.locale ?? FALLBACK_LOCALE;

  return useMemo(
    () => ({
      currency,
      locale,
      formatMoney: (value: string | number) => formatCurrency(value, currency, locale),
      formatMoneyCompact: (value: string | number) => formatCurrencyCompact(value, currency, locale),
      formatPercent: (fraction: number) => (Number.isFinite(fraction) ? formatPercent(fraction, locale) : '—'),
      formatDate: (value: string | null) => formatDateOnly(value, locale),
      formatMonth: (value: string) => formatMonthKey(value, locale),
    }),
    [currency, locale],
  );
}
