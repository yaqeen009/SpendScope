import type { ReactElement, ReactNode } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/controls';
import { ThemeProvider } from '@/hooks/use-theme';

/** A query client with retries disabled so failures surface immediately. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

export interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  route?: string;
  client?: QueryClient;
}

export function renderWithProviders(ui: ReactElement, options: RenderWithProvidersOptions = {}) {
  const { route = '/', client = createTestQueryClient(), ...renderOptions } = options;

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <TooltipProvider>
            <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    );
  }

  return { client, ...render(ui, { wrapper: Wrapper, ...renderOptions }) };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export type ApiHandler = (url: string, init?: RequestInit) => Response | Promise<Response> | undefined;

/**
 * Installs a `fetch` stub that dispatches to the first matching handler. A
 * request that matches no handler fails loudly so tests never pass on an
 * unexpected endpoint.
 */
export function stubApi(handlers: ApiHandler[]) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    for (const handler of handlers) {
      const response = await handler(url, init);
      if (response) return response;
    }
    throw new Error(`Unexpected request in test: ${url}`);
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

/** Convenience handler that answers every request whose URL contains `fragment`. */
export function route(fragment: string, body: unknown, status = 200): ApiHandler {
  return (url) => (url.includes(fragment) ? jsonResponse(body, status) : undefined);
}
