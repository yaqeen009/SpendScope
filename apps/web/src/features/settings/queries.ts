import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { SettingsDTO, UpdateSettingsInput } from '@spendscope/shared';

import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export interface DemoDataResult {
  action: string;
  transactions: number;
  budgets: number;
}

export interface ResetDataInput {
  confirm: string;
  includeImported: boolean;
  resetCategories: boolean;
}

export interface ResetDataResult {
  transactions: number;
  budgets: number;
  importBatches: number;
  categories: number;
}

export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => apiGet<{ data: SettingsDTO }>('/settings').then((response) => response.data),
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSettingsInput) =>
      apiPatch<{ data: SettingsDTO }>('/settings', input).then((response) => response.data),
    onSuccess: (settings) => {
      queryClient.setQueryData(queryKeys.settings, settings);
    },
  });
}

export function useManageDemoData() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: 'restore' | 'clear') =>
      apiPost<{ data: DemoDataResult }>('/settings/demo-data', { action }).then((response) => response.data),
    onSuccess: () => {
      void queryClient.invalidateQueries();
    },
  });
}

export function useResetData() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ResetDataInput) =>
      apiPost<{ data: ResetDataResult }>('/settings/reset', input).then((response) => response.data),
    onSuccess: () => {
      void queryClient.invalidateQueries();
    },
  });
}
