import { useQuery } from '@tanstack/react-query';

import type { AnalyticsQuery, CategoryBreakdownDTO, DashboardDTO, SummaryMetricsDTO, TimeSeriesDTO, TransactionDTO } from '@spendscope/shared';

import { apiGet } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export type AnalyticsParams = Partial<AnalyticsQuery> & { from?: string; to?: string };

function toParams(params: AnalyticsParams): Record<string, string | number | boolean> {
  const entries: Record<string, string | number | boolean> = { period: params.period ?? 'this_month' };
  if (params.from) entries.from = params.from;
  if (params.to) entries.to = params.to;
  if (params.compare !== undefined) entries.compare = params.compare;
  if (params.recentLimit !== undefined) entries.recentLimit = params.recentLimit;
  return entries;
}

export function useDashboard(params: AnalyticsParams) {
  const request = toParams(params);
  return useQuery({
    queryKey: queryKeys.analytics.dashboard(request),
    queryFn: ({ signal }) =>
      apiGet<{ data: DashboardDTO }>(`/analytics/dashboard?${new URLSearchParams(toStringRecord(request))}`, signal).then(
        (response) => response.data,
      ),
  });
}

export function useSummary(params: AnalyticsParams) {
  const request = toParams(params);
  return useQuery({
    queryKey: queryKeys.analytics.summary(request),
    queryFn: ({ signal }) =>
      apiGet<{ data: SummaryMetricsDTO }>(
        `/analytics/summary?${new URLSearchParams(toStringRecord(request))}`,
        signal,
      ).then((response) => response.data),
  });
}

export function useTimeSeries(params: AnalyticsParams) {
  const request = toParams(params);
  return useQuery({
    queryKey: queryKeys.analytics.timeSeries(request),
    queryFn: ({ signal }) =>
      apiGet<{ data: TimeSeriesDTO }>(
        `/analytics/time-series?${new URLSearchParams(toStringRecord(request))}`,
        signal,
      ).then((response) => response.data),
  });
}

export function useCategoryBreakdown(params: AnalyticsParams) {
  const request = toParams(params);
  return useQuery({
    queryKey: queryKeys.analytics.categories(request),
    queryFn: ({ signal }) =>
      apiGet<{ data: CategoryBreakdownDTO }>(
        `/analytics/categories?${new URLSearchParams(toStringRecord(request))}`,
        signal,
      ).then((response) => response.data),
  });
}

export function useMonthlyTrend(params: AnalyticsParams) {
  const request = toParams(params);
  return useQuery({
    queryKey: queryKeys.analytics.monthlyTrend(request),
    queryFn: ({ signal }) =>
      apiGet<{ data: { months: { month: string; income: string; expenses: string; net: string }[] } }>(
        `/analytics/monthly-trend?${new URLSearchParams(toStringRecord(request))}`,
        signal,
      ).then((response) => response.data),
  });
}

export function useLargestExpenses(params: AnalyticsParams) {
  const request = toParams(params);
  return useQuery({
    queryKey: queryKeys.analytics.largestExpenses(request),
    queryFn: ({ signal }) =>
      apiGet<{ data: TransactionDTO[] }>(
        `/analytics/largest-expenses?${new URLSearchParams(toStringRecord(request))}`,
        signal,
      ).then((response) => response.data),
  });
}

function toStringRecord(input: Record<string, string | number | boolean>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, String(value)]));
}
