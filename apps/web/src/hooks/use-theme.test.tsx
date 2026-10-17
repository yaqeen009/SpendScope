import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { ThemeProvider, useTheme } from '@/hooks/use-theme';

function Probe() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="preference">{theme}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <button type="button" onClick={() => setTheme('dark')}>
        Go dark
      </button>
      <button type="button" onClick={() => setTheme('light')}>
        Go light
      </button>
    </div>
  );
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('defaults to following the system preference', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('preference')).toHaveTextContent('system');
    // jsdom reports a light system preference via the matchMedia stub.
    expect(screen.getByTestId('resolved')).toHaveTextContent('light');
  });

  it('applies the chosen theme to the document and persists it', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Go dark' }));

    expect(screen.getByTestId('preference')).toHaveTextContent('dark');
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('spendscope-theme')).toBe('dark');

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Go light' }));
    });

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem('spendscope-theme')).toBe('light');
  });
});
