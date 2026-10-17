import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import { PERIOD_KEYS, resolvePeriod, type PeriodKey, type ReportingPeriod } from '@spendscope/shared';

const PERIOD_LABELS: Record<PeriodKey, string> = {
  this_month: 'This month',
  last_month: 'Last month',
  last_3_months: 'Last 3 months',
  this_year: 'This year',
  custom: 'Custom range',
};

export const PERIOD_OPTIONS: { value: PeriodKey; label: string }[] = PERIOD_KEYS.map((key) => ({
  value: key,
  label: PERIOD_LABELS[key],
}));

export interface PeriodSelection {
  period: ReportingPeriod;
  /** Query parameters the API expects, ready to spread into a request. */
  params: { period: PeriodKey; from?: string; to?: string };
  setPeriod: (key: PeriodKey, range?: { from: string; to: string }) => void;
}

function parseKey(value: string | null): PeriodKey {
  return PERIOD_KEYS.find((key) => key === value) ?? 'this_month';
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The reporting period is held in the URL so a view can be shared, reloaded or
 * bookmarked, and so every panel on a page reads the same range.
 */
export function usePeriod(defaultKey: PeriodKey = 'this_month'): PeriodSelection {
  const [searchParams, setSearchParams] = useSearchParams();

  const key = parseKey(searchParams.get('period') ?? defaultKey);
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');
  const from = fromParam && DATE_ONLY.test(fromParam) ? fromParam : undefined;
  const to = toParam && DATE_ONLY.test(toParam) ? toParam : undefined;

  const period = useMemo(
    () => resolvePeriod({ key, from, to }),
    [key, from, to],
  );

  const setPeriod = useCallback(
    (nextKey: PeriodKey, range?: { from: string; to: string }) => {
      const next = new URLSearchParams(searchParams);
      next.set('period', nextKey);
      if (nextKey === 'custom' && range) {
        next.set('from', range.from);
        next.set('to', range.to);
      } else {
        next.delete('from');
        next.delete('to');
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const params = useMemo(
    () => ({
      period: key,
      ...(key === 'custom' && from && to ? { from, to } : {}),
    }),
    [key, from, to],
  );

  return { period, params, setPeriod };
}
