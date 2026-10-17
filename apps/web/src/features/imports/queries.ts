import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  ImportBatchDTO,
  ImportCommitInput,
  ImportCommitResultDTO,
  ImportPreviewDTO,
  ImportPreviewInput,
  Paginated,
} from '@spendscope/shared';

import { apiGet, apiPost } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export function useImportHistory(page: number, pageSize = 10) {
  return useQuery({
    queryKey: queryKeys.imports.list(page, pageSize),
    queryFn: ({ signal }) =>
      apiGet<Paginated<ImportBatchDTO>>(`/imports?page=${page}&pageSize=${pageSize}`, signal),
    placeholderData: (previous) => previous,
  });
}

export function useImportBatch(id: string | null) {
  return useQuery({
    queryKey: queryKeys.imports.detail(id ?? ''),
    queryFn: ({ signal }) =>
      apiGet<{ data: ImportBatchDTO }>(`/imports/${id}`, signal).then((response) => response.data),
    enabled: Boolean(id),
  });
}

/**
 * Uploads CSV content (or re-runs validation for an existing preview with a
 * corrected mapping). The server always re-parses: nothing from a previous
 * response is trusted as input.
 */
export function usePreviewImport() {
  return useMutation({
    mutationFn: (input: ImportPreviewInput) =>
      apiPost<{ data: ImportPreviewDTO }>('/imports/preview', input).then((response) => response.data),
  });
}

export function useCommitImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ImportCommitInput) =>
      apiPost<{ data: ImportCommitResultDTO }>('/imports', input).then((response) => response.data),
    onSuccess: () => {
      void queryClient.invalidateQueries();
    },
  });
}
