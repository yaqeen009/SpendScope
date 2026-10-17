import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  CreateTransactionInput,
  Paginated,
  TransactionDTO,
  UpdateTransactionInput,
} from '@spendscope/shared';

import { apiDelete, apiGet, apiPatch, apiPost, toQuery } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export interface TransactionListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  from?: string;
  to?: string;
  categoryId?: string;
  type?: string;
  reviewStatus?: string;
  importBatchId?: string;
  minAmount?: string;
  maxAmount?: string;
  sortBy?: 'date' | 'amount' | 'description';
  sortOrder?: 'asc' | 'desc';
}

export function useTransactions(params: TransactionListParams) {
  return useQuery({
    queryKey: queryKeys.transactions.list(params),
    queryFn: ({ signal }) =>
      apiGet<Paginated<TransactionDTO>>(`/transactions${toQuery({ ...params })}`, signal),
    placeholderData: (previous) => previous,
  });
}

export function useTransaction(id: string | null) {
  return useQuery({
    queryKey: queryKeys.transactions.detail(id ?? ''),
    queryFn: ({ signal }) =>
      apiGet<{ data: TransactionDTO }>(`/transactions/${id}`, signal).then((response) => response.data),
    enabled: Boolean(id),
  });
}

function invalidateAll(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all });
  void queryClient.invalidateQueries({ queryKey: queryKeys.analytics.all });
  void queryClient.invalidateQueries({ queryKey: queryKeys.categories.all });
  void queryClient.invalidateQueries({ queryKey: queryKeys.budgets.all });
}

export function useCreateTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTransactionInput) =>
      apiPost<{ data: TransactionDTO }>('/transactions', input).then((response) => response.data),
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useUpdateTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateTransactionInput }) =>
      apiPatch<{ data: TransactionDTO }>(`/transactions/${id}`, input).then((response) => response.data),
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useDeleteTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/transactions/${id}`),
    onSuccess: () => invalidateAll(queryClient),
  });
}
