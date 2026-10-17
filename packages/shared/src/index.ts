export * from './enums.ts';
export * from './date.ts';
export * from './money.ts';
export * from './periods.ts';
export * from './format.ts';
export * from './types.ts';
export * from './schemas/common.ts';
export * from './schemas/auth.ts';
export * from './schemas/transaction.ts';
export * from './schemas/category.ts';
export * from './schemas/category-rule.ts';
export * from './schemas/backup.ts';
export * from './schemas/export.ts';
export * from './schemas/budget.ts';
export * from './schemas/import.ts';
export * from './schemas/settings.ts';
export * from './schemas/analytics.ts';

/** Default category catalogue seeded on first run. */
export const DEFAULT_CATEGORIES: readonly {
  name: string;
  kind: 'INCOME' | 'EXPENSE';
  color: string;
  description: string;
}[] = [
  { name: 'Salary', kind: 'INCOME', color: '#0f766e', description: 'Regular employment income' },
  { name: 'Freelance', kind: 'INCOME', color: '#0d9488', description: 'Contract and freelance work' },
  { name: 'Business Income', kind: 'INCOME', color: '#14b8a6', description: 'Revenue from a business' },
  { name: 'Interest', kind: 'INCOME', color: '#2dd4bf', description: 'Bank interest and dividends' },
  { name: 'Other Income', kind: 'INCOME', color: '#5eead4', description: 'Income that does not fit elsewhere' },
  { name: 'Housing', kind: 'EXPENSE', color: '#b45309', description: 'Rent, mortgage and housing costs' },
  { name: 'Groceries', kind: 'EXPENSE', color: '#16a34a', description: 'Food and household shopping' },
  { name: 'Transport', kind: 'EXPENSE', color: '#2563eb', description: 'Fuel, fares and vehicle costs' },
  { name: 'Utilities', kind: 'EXPENSE', color: '#7c3aed', description: 'Electricity, water and internet' },
  { name: 'Healthcare', kind: 'EXPENSE', color: '#dc2626', description: 'Medical care and medication' },
  { name: 'Education', kind: 'EXPENSE', color: '#0891b2', description: 'Tuition, books and courses' },
  { name: 'Shopping', kind: 'EXPENSE', color: '#db2777', description: 'Clothing and general purchases' },
  { name: 'Entertainment', kind: 'EXPENSE', color: '#ca8a04', description: 'Leisure and events' },
  { name: 'Dining', kind: 'EXPENSE', color: '#ea580c', description: 'Restaurants and takeaway' },
  { name: 'Subscriptions', kind: 'EXPENSE', color: '#9333ea', description: 'Recurring digital services' },
  { name: 'Personal Care', kind: 'EXPENSE', color: '#e11d48', description: 'Grooming and wellbeing' },
  { name: 'Other Expenses', kind: 'EXPENSE', color: '#64748b', description: 'Expenses that do not fit elsewhere' },
] as const;
