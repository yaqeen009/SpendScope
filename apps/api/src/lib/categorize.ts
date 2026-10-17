import type { TransactionType } from '@spendscope/shared';

import { normalizeText } from './fingerprint.ts';

/**
 * Deterministic, rule-based category suggestions.
 *
 * This is a keyword heuristic, NOT machine learning or "AI". It matches known
 * merchant keywords in the description/merchant text and proposes one of the
 * default categories. When nothing matches the transaction stays
 * **uncategorised** — we never invent a category. Users review and can change
 * every suggestion in the import wizard.
 *
 * Rules are ordered: the first match wins, so more specific patterns come first.
 */

export interface CategoryRule {
  /** Default category name this rule suggests. */
  category: string;
  /** Transaction types the rule applies to. */
  kinds: readonly ('INCOME' | 'EXPENSE')[];
  /** Lower-case keyword fragments matched against normalised text. */
  keywords: readonly string[];
}

export const CATEGORY_RULES: readonly CategoryRule[] = [
  // Income first: salary/employer credits.
  { category: 'Salary', kinds: ['INCOME'], keywords: ['salary', 'payroll', 'wages', 'monthly pay'] },
  { category: 'Interest', kinds: ['INCOME'], keywords: ['interest earned', 'interest credit', 'dividend'] },
  { category: 'Freelance', kinds: ['INCOME'], keywords: ['freelance', 'upwork', 'fiverr', 'contract payment', 'invoice'] },
  { category: 'Business Income', kinds: ['INCOME'], keywords: ['sales proceeds', 'business income', 'pos settlement'] },

  // Groceries / supermarkets.
  { category: 'Groceries', kinds: ['EXPENSE'], keywords: ['supermarket', 'grocer', 'market', 'shoprite', 'melcom', 'koala', 'food stuff', 'provisions'] },
  // Dining.
  { category: 'Dining', kinds: ['EXPENSE'], keywords: ['restaurant', 'cafe', 'coffee', 'pizza', 'burger', 'kfc', 'chicken', 'eatery', 'chop bar', 'takeaway'] },
  // Subscriptions.
  { category: 'Subscriptions', kinds: ['EXPENSE'], keywords: ['netflix', 'spotify', 'subscription', 'icloud', 'google one', 'prime video', 'youtube premium', 'apple com bill'] },
  // Utilities.
  { category: 'Utilities', kinds: ['EXPENSE'], keywords: ['electricity', 'ecg', 'water bill', 'gwcl', 'internet', 'broadband', 'airtime', 'data bundle', 'utility', 'dstv', 'gotv'] },
  // Transport.
  { category: 'Transport', kinds: ['EXPENSE'], keywords: ['uber', 'bolt', 'taxi', 'fuel', 'petrol', 'diesel', 'shell', 'total energ', 'goil', 'trotro', 'transport', 'parking', 'toll'] },
  // Housing.
  { category: 'Housing', kinds: ['EXPENSE'], keywords: ['rent', 'mortgage', 'landlord', 'maintenance fee', 'service charge estate'] },
  // Healthcare.
  { category: 'Healthcare', kinds: ['EXPENSE'], keywords: ['pharmacy', 'hospital', 'clinic', 'medical', 'nhis', 'doctor', 'laboratory', 'optical'] },
  // Education.
  { category: 'Education', kinds: ['EXPENSE'], keywords: ['school fees', 'tuition', 'university', 'college', 'books', 'udemy', 'coursera', 'exam fee'] },
  // Entertainment.
  { category: 'Entertainment', kinds: ['EXPENSE'], keywords: ['cinema', 'movie', 'concert', 'games', 'playstation', 'steam', 'event ticket', 'bar ', 'night club'] },
  // Personal care.
  { category: 'Personal Care', kinds: ['EXPENSE'], keywords: ['salon', 'barber', 'spa', 'cosmetic', 'beauty', 'laundry', 'gym'] },
  // Shopping.
  { category: 'Shopping', kinds: ['EXPENSE'], keywords: ['amazon', 'jumia', 'aliexpress', 'clothing', 'boutique', 'electronics', 'furniture', 'store', 'mall', 'decathlon'] },
];

export interface SuggestionInput {
  description: string;
  merchant?: string | null;
  /** Use the transaction type to restrict rules to income or expense. */
  type?: TransactionType | null;
}

export function suggestCategoryName(input: SuggestionInput): string | null {
  const haystack = normalizeText(`${input.description} ${input.merchant ?? ''}`);
  if (haystack.length === 0) return null;

  for (const rule of CATEGORY_RULES) {
    if (input.type === 'INCOME' && !rule.kinds.includes('INCOME')) continue;
    if ((input.type === 'EXPENSE' || input.type === 'REFUND') && !rule.kinds.includes('EXPENSE')) continue;
    for (const keyword of rule.keywords) {
      if (haystack.includes(keyword)) return rule.category;
    }
  }
  return null;
}
