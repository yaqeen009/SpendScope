import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SettingsDTO } from '@spendscope/shared';

import { SettingsPage } from '@/features/settings/settings-page';
import { renderWithProviders, route, stubApi } from '@/test/test-utils';

const settings: SettingsDTO = {
  workspaceId: 'workspace-1',
  currency: 'GHS',
  locale: 'en-GH',
  theme: 'system',
  defaultPeriod: 'this_month',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SettingsPage', () => {
  it('states that the currency setting never converts stored amounts', async () => {
    stubApi([route('/settings', { data: settings })]);

    renderWithProviders(<SettingsPage />);

    expect(await screen.findByLabelText('Currency')).toHaveValue('GHS');
    expect(screen.getByText(/does not convert your data/i)).toBeInTheDocument();
    expect(screen.getByText(/never converts or restates a stored amount/i)).toBeInTheDocument();
  });

  it('enables saving once a preference changes', async () => {
    const user = userEvent.setup();
    const fetchMock = stubApi([
      route('/settings', { data: settings }),
      (url, init) => (url.endsWith('/settings') && init?.method === 'PATCH'
        ? Promise.resolve(new Response(JSON.stringify({ data: { ...settings, currency: 'USD' } }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
        : undefined),
    ]);

    renderWithProviders(<SettingsPage />);
    await screen.findByLabelText('Currency');

    const saveButton = screen.getByRole('button', { name: /save preferences/i });
    expect(saveButton).toBeDisabled();

    await user.selectOptions(screen.getByLabelText('Currency'), 'USD');
    expect(saveButton).toBeEnabled();

    await user.click(saveButton);

    await vi.waitFor(() => {
      const patched = fetchMock.mock.calls.some((call) => (call[1] as RequestInit | undefined)?.method === 'PATCH');
      expect(patched).toBe(true);
    });
  });

  it('requires the RESET confirmation token before destructive reset', async () => {
    const user = userEvent.setup();
    stubApi([route('/settings', { data: settings })]);

    renderWithProviders(<SettingsPage />);
    await screen.findByLabelText('Currency');

    await user.click(screen.getByRole('button', { name: /reset workspace data/i }));

    expect(await screen.findByLabelText(/type reset to confirm/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^reset data$/i })).toBeInTheDocument();
  });
});
