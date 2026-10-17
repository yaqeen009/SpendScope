import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { BudgetDTO, BudgetProgressDTO, CreateBudgetInput, UpdateBudgetInput } from '@spendscope/shared';

import { apiDelete, apiGet, apiPatch, apiPost, toQuery } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export interface BudgetListParams {
  month?: string;
  from?: string;
  to?: string;
}

export function useBudgets(params: BudgetListParams = {}) {
  return useQuery({
    queryKey: queryKeys.budgets.list(params),
    queryFn: ({ signal }) =>
      apiGet<{ data: BudgetDTO[] }>(`/budgets${toQuery({ ...params })}`, signal).then(
        (response) => response.data,
      ),
  });
}

export function useBudgetProgress(month: string) {
  return useQuery({
    queryKey: queryKeys.budgets.progress(month),
    queryFn: ({ signal }) =>
      apiGet<{ data: BudgetProgressDTO }>(`/budgets/progress/${month}`, signal).then(
        (response) => response.data,
      ),
    enabled: /^\d{4}-\d{2}$/.test(month),
  });
}

function invalidateBudgetConsumers(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.budgets.all });
  void queryClient.invalidateQueries({ queryKey: queryKeys.analytics.all });
}

export function useCreateBudget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBudgetInput) =>
      apiPost<{ data: BudgetDTO }>('/budgets', input).then((response) => response.data),
    onSuccess: () => invalidateBudgetConsumers(queryClient),
  });
}

export function useUpdateBudget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateBudgetInput }) =>
      apiPatch<{ data: BudgetDTO }>(`/budgets/${id}`, input).then((response) => response.data),
    onSuccess: () => invalidateBudgetConsumers(queryClient),
  });
}

export function useDeleteBudget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/budgets/${id}`),
    onSuccess: () => invalidateBudgetConsumers(queryClient),
  });
}
