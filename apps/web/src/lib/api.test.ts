import { describe, expect, it } from 'vitest';

import { API_PREFIX, ApiError, apiGet, apiRequest, errorMessage } from '@/lib/api';
import { jsonResponse, stubApi } from '@/test/test-utils';

/**
 * The API client's contract with the server: a JSON envelope on every response,
 * and a failure message that says what actually went wrong.
 *
 * The non-JSON case is the one that matters in deployment. When the SPA is
 * built without `VITE_API_URL` and the API lives on another domain, every call
 * lands on the static host, which answers with its own 404 page or the SPA
 * shell. That produced an opaque `status 404`; it now names the problem.
 */

describe('apiRequest', () => {
  it('parses a JSON envelope', async () => {
    stubApi([(url) => (url.includes('/health') ? jsonResponse({ data: { status: 'ok' } }) : undefined)]);

    await expect(apiGet<{ data: { status: string } }>('/health')).resolves.toEqual({ data: { status: 'ok' } });
  });

  it('sends the versioned path with credentials and no credentials in the body', async () => {
    const fetchMock = stubApi([() => jsonResponse({ data: {} })]);

    await apiGet('/health');

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_PREFIX}/health`,
      expect.objectContaining({ credentials: 'include', method: 'GET' }),
    );
  });

  it('surfaces a JSON error envelope as an ApiError', async () => {
    stubApi([() => jsonResponse({ error: { code: 'CONFLICT', message: 'That email is already registered' } }, 409)]);

    const error = await apiGet('/auth/register').catch((caught) => caught as ApiError);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: 'CONFLICT', message: 'That email is already registered' });
  });

  it('names a non-JSON response instead of failing opaquely', async () => {
    // What Vercel returns for `/api/v1/...` when the bundle has no API base URL.
    stubApi([
      () =>
        new Response('The page could not be found\n\nNOT_FOUND', {
          status: 404,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        }),
    ]);

    const error = await apiGet('/auth/config').catch((caught) => caught as ApiError);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('INVALID_RESPONSE');
    expect(errorMessage(error)).toMatch(/did not return JSON/);
  });

  it('treats a 204 as empty content', async () => {
    stubApi([() => new Response(null, { status: 204 })]);

    await expect(apiRequest<void>('/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('reports a network failure as a plain error, not an ApiError', async () => {
    stubApi([() => Promise.reject(new TypeError('Failed to fetch'))]);

    const error = await apiGet('/health').catch((caught) => caught as Error);

    expect(error).not.toBeInstanceOf(ApiError);
    expect(errorMessage(error)).toBe('Failed to fetch');
  });
});
