import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SignInPage } from '@/features/auth/sign-in-page';
import { AuthProvider } from '@/features/auth/auth-provider';
import { renderWithProviders, route, stubApi } from '@/test/test-utils';

/**
 * The sign-in screen is the entry point for the public app, so it is also where
 * a visitor decides to create an account. Registration visibility follows the
 * server's `GET /auth/config`, never a frontend constant.
 */

function configHandler(body: unknown) {
  return route('/auth/config', body, 200);
}

describe('SignInPage', () => {
  it('offers registration through a link when the server allows it', async () => {
    stubApi([
      configHandler({ data: { registrationEnabled: true, minPasswordLength: 12, sessionTtlHours: 720 } }),
      route('/auth/me', { error: { code: 'UNAUTHORIZED', message: 'Not signed in' } }, 401),
    ]);
    renderWithProviders(
      <AuthProvider>
        <SignInPage />
      </AuthProvider>,
      { route: '/sign-in' },
    );

    const create = await screen.findByRole('link', { name: 'Create one' });
    expect(create).toHaveAttribute('href', '/sign-up');
  });

  it('says registration is disabled when the server turns it off', async () => {
    stubApi([
      configHandler({ data: { registrationEnabled: false, minPasswordLength: 12, sessionTtlHours: 720 } }),
      route('/auth/me', { error: { code: 'UNAUTHORIZED', message: 'Not signed in' } }, 401),
    ]);
    renderWithProviders(
      <AuthProvider>
        <SignInPage />
      </AuthProvider>,
      { route: '/sign-in' },
    );

    expect(await screen.findByText('Registration is disabled on this installation.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Create one' })).not.toBeInTheDocument();
  });

  it('does not claim registration is disabled while the answer is unknown', () => {
    stubApi([
      // The configuration request never settles, as when the API is unreachable.
      () => new Promise<Response>(() => {}),
    ]);
    renderWithProviders(
      <AuthProvider>
        <SignInPage />
      </AuthProvider>,
      { route: '/sign-in' },
    );

    expect(screen.queryByText('Registration is disabled on this installation.')).not.toBeInTheDocument();
  });

  it('reports a configuration failure instead of claiming registration is off', async () => {
    stubApi([
      route('/auth/config', { error: { code: 'INTERNAL', message: 'boom' } }, 500),
      route('/auth/me', { error: { code: 'UNAUTHORIZED', message: 'Not signed in' } }, 401),
    ]);
    renderWithProviders(
      <AuthProvider>
        <SignInPage />
      </AuthProvider>,
      { route: '/sign-in' },
    );

    expect(await screen.findByText(/Could not reach SpendScope to check registration/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByText('Registration is disabled on this installation.')).not.toBeInTheDocument();
  });

  it('shows a validation error for a malformed email without submitting', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    stubApi([
      configHandler({ data: { registrationEnabled: true, minPasswordLength: 12, sessionTtlHours: 720 } }),
      route('/auth/me', { error: { code: 'UNAUTHORIZED', message: 'Not signed in' } }, 401),
    ]);
    renderWithProviders(
      <AuthProvider>
        <SignInPage />
      </AuthProvider>,
      { route: '/sign-in' },
    );

    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.type(screen.getByLabelText('Password'), 'a-strong-passw0rd');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
  });
});
