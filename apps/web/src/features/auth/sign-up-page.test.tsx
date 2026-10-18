import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { SignUpPage } from '@/features/auth/sign-up-page';
import { AuthProvider } from '@/features/auth/auth-provider';
import { jsonResponse, renderWithProviders, route, stubApi, type ApiHandler } from '@/test/test-utils';

/**
 * Public registration through the real API client.
 *
 * The session is an `HttpOnly` cookie, so a successful response carries it in
 * `Set-Cookie` and the app treats the returned state as signed in. The fetch
 * stubs stand in for the Render backend; no account is ever created anywhere.
 */

const VALID_PASSWORD = 'a-strong-passw0rd';

const registeredState = {
  user: { id: 'user-1', email: 'new@example.test', name: 'New User', createdAt: '2026-01-01T00:00:00.000Z' },
  workspace: { id: 'workspace-1', name: 'Personal', isDemo: false },
};

/** Answers `/auth/me` (anonymous) and, when given, `/auth/register`. */
function handlers(extra: ApiHandler[] = []): ApiHandler[] {
  return [
    route('/auth/me', { error: { code: 'UNAUTHORIZED', message: 'Not signed in' } }, 401),
    ...extra,
  ];
}

function registerHandler(status: number, body: unknown): ApiHandler {
  return route('/auth/register', body, status);
}

function setCookieFor(token: string): ResponseInit {
  return {
    status: 201,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `spendscope_session=${token}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`,
    },
  };
}

async function fillForm(user: ReturnType<typeof userEvent.setup>, overrides: Record<string, string> = {}) {
  await user.type(screen.getByLabelText('Name'), overrides.name ?? 'New User');
  await user.type(screen.getByLabelText('Email'), overrides.email ?? 'new@example.test');
  await user.type(screen.getByLabelText('Password'), overrides.password ?? VALID_PASSWORD);
  await user.type(screen.getByLabelText('Confirm password'), overrides.confirmPassword ?? VALID_PASSWORD);
}

describe('SignUpPage', () => {
  it('renders the registration form', () => {
    stubApi(handlers());
    renderWithProviders(<AuthProvider><SignUpPage /></AuthProvider>, { route: '/sign-up' });

    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument();
  });

  it('shows field-level validation errors and does not submit', async () => {
    const user = userEvent.setup();
    const fetchMock = stubApi(handlers());
    renderWithProviders(<AuthProvider><SignUpPage /></AuthProvider>, { route: '/sign-up' });

    await fillForm(user, { password: 'short', confirmPassword: 'short' });
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Password must be at least 12 characters')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/auth/register'), expect.anything());
  });

  it('rejects a mismatched confirmation before submitting', async () => {
    const user = userEvent.setup();
    const fetchMock = stubApi(handlers());
    renderWithProviders(<AuthProvider><SignUpPage /></AuthProvider>, { route: '/sign-up' });

    await fillForm(user, { confirmPassword: 'different-passw0rd' });
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/auth/register'), expect.anything());
  });

  it('sends the registration request to the configured API base URL', async () => {
    const user = userEvent.setup();
    const fetchMock = stubApi(handlers([registerHandler(201, { data: registeredState })]));
    renderWithProviders(<AuthProvider><SignUpPage /></AuthProvider>, { route: '/sign-up' });

    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/auth/register'),
        expect.objectContaining({ method: 'POST', credentials: 'include' }),
      ),
    );
  });

  it('establishes a session and redirects to the dashboard on success', async () => {
    const user = userEvent.setup();

    // Mirrors the real backend: /auth/me is anonymous until a session exists.
    let signedIn = false;
    stubApi([
      (url) => {
        if (url.includes('/auth/register')) {
          signedIn = true;
          return Promise.resolve(new Response(JSON.stringify({ data: registeredState }), setCookieFor('token-123')));
        }
        if (url.includes('/auth/me')) {
          return Promise.resolve(
            signedIn
              ? jsonResponse({ data: registeredState })
              : jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'Not signed in' } }, 401),
          );
        }
        return undefined;
      },
    ]);

    renderWithProviders(<AuthProvider><SignUpPage /></AuthProvider>, { route: '/sign-up' });

    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    // The cached auth state flips to authenticated, so the page redirects to '/'
    // instead of showing the form again.
    await waitFor(() => expect(screen.queryByLabelText('Email')).not.toBeInTheDocument());
  });

  it('shows a server error without redirecting', async () => {
    const user = userEvent.setup();
    stubApi(handlers([registerHandler(409, { error: { code: 'CONFLICT', message: 'An account with that email already exists' } })]));
    renderWithProviders(<AuthProvider><SignUpPage /></AuthProvider>, { route: '/sign-up' });

    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('An account with that email already exists')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument();
  });

  it('surfaces a network failure as a form error', async () => {
    const user = userEvent.setup();
    stubApi([
      route('/auth/me', { error: { code: 'UNAUTHORIZED', message: 'Not signed in' } }, 401),
      () => Promise.reject(new Error('Failed to fetch')),
    ]);
    renderWithProviders(<AuthProvider><SignUpPage /></AuthProvider>, { route: '/sign-up' });

    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText(/Failed to fetch/)).toBeInTheDocument();
  });
});
