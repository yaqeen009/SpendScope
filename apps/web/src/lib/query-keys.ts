/**
 * Centralised TanStack Query keys.
 *
 * Every key is a tuple so related keys share a prefix and can be invalidated as
 * a group (for example `queryKeys.transactions.all` clears every transaction
 * list and detail after a mutation).
 */
export const queryKeys = {
  health: ['health'] as const,
  settings: ['settings'] as const,

  transactions: {
    all: ['transactions'] as const,
    list: (params: object) => ['transactions', 'list', params] as const,
    detail: (id: string) => ['transactions', 'detail', id] as const,
  },

  categories: {
    all: ['categories'] as const,
    list: () => ['categories', 'list'] as const,
  },

  budgets: {
    all: ['budgets'] as const,
    list: (params: object) => ['budgets', 'list', params] as const,
    progress: (month: string) => ['budgets', 'progress', month] as const,
  },

  analytics: {
    all: ['analytics'] as const,
    dashboard: (params: object) => ['analytics', 'dashboard', params] as const,
    summary: (params: object) => ['analytics', 'summary', params] as const,
    timeSeries: (params: object) => ['analytics', 'time-series', params] as const,
    categories: (params: object) => ['analytics', 'categories', params] as const,
    monthlyTrend: (params: object) => ['analytics', 'monthly-trend', params] as const,
    largestExpenses: (params: object) => ['analytics', 'largest-expenses', params] as const,
  },

  imports: {
    all: ['imports'] as const,
    list: (page: number, pageSize: number) => ['imports', 'list', page, pageSize] as const,
    detail: (id: string) => ['imports', 'detail', id] as const,
  },
} as const;
