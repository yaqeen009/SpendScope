import { describe, expect, it } from 'vitest';

import { suggestCategoryName } from './categorize.ts';

describe('suggestCategoryName', () => {
  it('suggests groceries for supermarket merchants', () => {
    expect(suggestCategoryName({ description: 'Weekly shop', merchant: 'ShopRite', type: 'EXPENSE' })).toBe('Groceries');
  });

  it('suggests transport for ride hailing and fuel', () => {
    expect(suggestCategoryName({ description: 'Trip to office', merchant: 'Uber', type: 'EXPENSE' })).toBe('Transport');
    expect(suggestCategoryName({ description: 'Fuel at GOIL station', type: 'EXPENSE' })).toBe('Transport');
  });

  it('suggests subscriptions for streaming services', () => {
    expect(suggestCategoryName({ description: 'Netflix monthly', type: 'EXPENSE' })).toBe('Subscriptions');
  });

  it('respects the transaction type for income', () => {
    expect(suggestCategoryName({ description: 'Monthly salary — Acme Corp', type: 'INCOME' })).toBe('Salary');
  });

  it('does not suggest income categories for expenses', () => {
    expect(suggestCategoryName({ description: 'salary advance repayment fee', type: 'EXPENSE' })).not.toBe('Salary');
  });

  it('returns null when nothing matches (never invents a category)', () => {
    expect(suggestCategoryName({ description: 'POS PURCHASE 88213', type: 'EXPENSE' })).toBeNull();
    expect(suggestCategoryName({ description: '', type: 'EXPENSE' })).toBeNull();
  });
});
