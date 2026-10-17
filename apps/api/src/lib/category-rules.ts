import type { CategoryKind, RuleMatchField, TransactionType } from '@spendscope/shared';

import { kindForType } from './import-parse.ts';
import { prisma } from './prisma.ts';

/**
 * Category-rule matching.
 *
 * A rule assigns a category to a row that has none. Two properties matter and
 * are both enforced here:
 *
 *  - **Deterministic order.** Candidate rules are sorted by `priority` (lower
 *    first), then by descending pattern length (so a more specific pattern beats
 *    a broader one at the same priority), then by `createdAt`, then by `id`.
 *    The same rules over the same data therefore always produce the same result.
 *  - **Kind safety.** A rule whose category is an expense category can never
 *    categorise income, and vice versa. Rules never apply to transfers.
 */

/** Normalised form stored in the database and used for matching. */
export function normalizePattern(pattern: string): string {
  return pattern.trim().toLowerCase();
}

export interface RuleInput {
  description: string;
  merchant: string | null;
  type: TransactionType | null;
}

export interface RuleMatch {
  ruleId: string;
  categoryId: string;
}

export interface LoadedRule {
  id: string;
  matchField: RuleMatchField;
  pattern: string;
  categoryId: string;
  priority: number;
  kind: CategoryKind;
}

/**
 * Orders rules by precedence. Exported because the API returns rules in the same
 * order they are evaluated, so what the user sees is what runs.
 */
export function compareRules(a: LoadedRule, b: LoadedRule): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  if (a.pattern.length !== b.pattern.length) return b.pattern.length - a.pattern.length;
  return a.id.localeCompare(b.id);
}

function matches(rule: LoadedRule, input: RuleInput): boolean {
  const description = input.description.toLowerCase();
  const merchant = (input.merchant ?? '').toLowerCase();

  switch (rule.matchField) {
    case 'DESCRIPTION':
      return description.includes(rule.pattern);
    case 'MERCHANT':
      return merchant.includes(rule.pattern);
    case 'ANY':
      return description.includes(rule.pattern) || merchant.includes(rule.pattern);
    default:
      return false;
  }
}

/** Rules that can apply to a transaction of the given type, in precedence order. */
export function rulesForType(rules: readonly LoadedRule[], type: TransactionType | null): LoadedRule[] {
  if (!type || type === 'TRANSFER') return [];
  const kind = kindForType(type);
  return rules.filter((rule) => rule.kind === kind);
}

/** First matching rule, or `null`. */
export function firstMatch(rules: readonly LoadedRule[], input: RuleInput): RuleMatch | null {
  for (const rule of rulesForType(rules, input.type)) {
    if (matches(rule, input)) return { ruleId: rule.id, categoryId: rule.categoryId };
  }
  return null;
}

/** Loads the workspace's active rules in evaluation order. */
export async function loadActiveRules(workspaceId: string): Promise<LoadedRule[]> {
  const rows = await prisma.categoryRule.findMany({
    where: { workspaceId, isActive: true },
    select: {
      id: true,
      matchField: true,
      pattern: true,
      categoryId: true,
      priority: true,
      category: { select: { kind: true } },
    },
  });

  return rows
    .map<LoadedRule>((row) => ({
      id: row.id,
      matchField: row.matchField,
      pattern: row.pattern,
      categoryId: row.categoryId,
      priority: row.priority,
      kind: row.category.kind,
    }))
    .sort(compareRules);
}
