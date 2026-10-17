import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CategoryDTO } from '@spendscope/shared';

import { CategoryFormDialog } from '@/features/categories/category-form-dialog';
import { renderWithProviders } from '@/test/test-utils';

const category: CategoryDTO = {
  id: 'cat-1',
  name: 'Groceries',
  kind: 'EXPENSE',
  color: '#123456',
  description: 'Food shopping',
  isDefault: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  transactionCount: 0,
  lifetimeTotal: '0.00',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CategoryFormDialog', () => {
  it('prefills the colour from the category and keeps both colour controls in sync', async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <CategoryFormDialog open onOpenChange={() => {}} category={category} />,
    );

    const hexInput = screen.getByLabelText('Colour hex value');
    expect(hexInput).toHaveValue('#123456');

    await user.clear(hexInput);
    await user.type(hexInput, '#abcdef');

    // The swatch input reads the same form value: no second, diverging source.
    expect(document.getElementById('category-color')).toHaveValue('#abcdef');
  });

  it('does not allow changing the classification once transactions exist', () => {
    const used = { ...category, transactionCount: 5 };

    renderWithProviders(<CategoryFormDialog open onOpenChange={() => {}} category={used} />);

    expect(screen.getByLabelText('Classification')).toBeDisabled();
    expect(
      screen.getByText(/cannot change while transactions are assigned/i),
    ).toBeInTheDocument();
  });
});
