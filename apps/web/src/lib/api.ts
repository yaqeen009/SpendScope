/**
 * Thin typed wrapper around `fetch` for the versioned REST API.
 *
 * The base URL is empty by default: in development Vite proxies `/api` to the
 * backend, and in production the API is expected to be served behind the same
 * origin. Set `VITE_API_URL` to point at a different host.
 */
const BASE_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export const API_PREFIX = '/api/v1';

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = payload.code;
    this.details = payload.details;
  }
}

/** Extracts a human-readable message from an unknown thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}

/** Row-level validation issues returned by `VALIDATION_ERROR` responses. */
export function validationIssues(error: unknown): { path: string; message: string }[] {
  if (!(error instanceof ApiError)) return [];
  if (!Array.isArray(error.details)) return [];
  return error.details.flatMap((issue) => {
    if (typeof issue !== 'object' || issue === null) return [];
    const record = issue as { path?: unknown; message?: unknown };
    if (typeof record.path !== 'string' || typeof record.message !== 'string') return [];
    return [{ path: record.path, message: record.message }];
  });
}

async function parse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const body: unknown = text.length > 0 ? safeJson(text) : null;

  if (!response.ok) {
    const envelope = body as { error?: Partial<ApiErrorPayload> } | null;
    throw new ApiError(response.status, {
      code: envelope?.error?.code ?? 'UNKNOWN',
      message: envelope?.error?.message ?? `Request failed with status ${response.status}`,
      details: envelope?.error?.details,
    });
  }

  return body as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Skip the global 401 handler (used while probing the session). */
  skipAuthRedirect?: boolean;
}

/**
 * Called when the API answers 401, so the auth layer can clear its cache and
 * send the user to the sign-in screen. Registered once by the auth provider.
 */
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, skipAuthRedirect = false } = options;

  const response = await fetch(`${BASE_URL}${API_PREFIX}${path}`, {
    method,
    // The session is an HttpOnly cookie: it is only sent when credentials are
    // included, and never read by JavaScript.
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  if (response.status === 401 && !skipAuthRedirect) {
    unauthorizedHandler?.();
  }

  return parse<T>(response);
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  return apiRequest<T>(path, { signal });
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return apiRequest<T>(path, { method: 'POST', body });
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return apiRequest<T>(path, { method: 'PATCH', body });
}

export async function apiDelete(path: string): Promise<void> {
  await apiRequest<void>(path, { method: 'DELETE' });
}

/** Builds a query string, skipping empty values. */
export function toQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query.length > 0 ? `?${query}` : '';
}

/**
 * URL for a non-JSON API route (the CSV template and error report downloads).
 * These must bypass `fetch` so the browser can handle the download itself.
 */
export function apiDownloadUrl(path: string): string {
  return `${BASE_URL}${API_PREFIX}${path}`;
}
