import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { CategoryDTO, CreateCategoryInput, UpdateCategoryInput } from '@spendscope/shared';

import { apiGet, apiPatch, apiPost, apiRequest, toQuery } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export interface DeleteCategoryInput {
  id: string;
  strategy: 'block' | 'uncategorize' | 'reassign';
  reassignTo?: string;
}

export interface DeleteCategoryResult {
  deleted: true;
  reassigned: number;
  uncategorized: number;
}

export function useCategories() {
  return useQuery({
    queryKey: queryKeys.categories.list(),
    queryFn: ({ signal }) =>
      apiGet<{ data: CategoryDTO[] }>('/categories', signal).then((response) => response.data),
  });
}

function invalidateCategoryConsumers(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.categories.all });
  void queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all });
  void queryClient.invalidateQueries({ queryKey: queryKeys.analytics.all });
  void queryClient.invalidateQueries({ queryKey: queryKeys.budgets.all });
}

export function useCreateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCategoryInput) =>
      apiPost<{ data: CategoryDTO }>('/categories', input).then((response) => response.data),
    onSuccess: () => invalidateCategoryConsumers(queryClient),
  });
}

export function useUpdateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateCategoryInput }) =>
      apiPatch<{ data: CategoryDTO }>(`/categories/${id}`, input).then((response) => response.data),
    onSuccess: () => invalidateCategoryConsumers(queryClient),
  });
}

export function useDeleteCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, strategy, reassignTo }: DeleteCategoryInput) =>
      apiRequest<{ data: DeleteCategoryResult }>(`/categories/${id}${toQuery({ strategy, reassignTo })}`, {
        method: 'DELETE',
      }).then((response) => response.data),
    onSuccess: () => invalidateCategoryConsumers(queryClient),
  });
}
