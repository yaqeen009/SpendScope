import { QueryClient } from '@tanstack/react-query';

/**
 * Shared React Query client. Queries are refetched on window focus (handy when
 * you edit data in another tab) and one retry is enough for a local API.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: true,
      staleTime: 30 * 1000,
    },
  },
});
