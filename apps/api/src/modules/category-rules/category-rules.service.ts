import type {
  ApplyCategoryRulesInput,
  CategoryRuleApplyResultDTO,
  CategoryRuleDTO,
  CreateCategoryRuleInput,
  RuleMatchField,
  UpdateCategoryRuleInput,
} from '@spendscope/shared';

import { loadActiveRules, normalizePattern, firstMatch, type LoadedRule } from '../../lib/category-rules.ts';
import { ConflictError, NotFoundError } from '../../lib/errors.ts';
import { prisma } from '../../lib/prisma.ts';
import { toCategoryRuleDTO } from '../../lib/serializers.ts';

/**
 * Category-rule CRUD and retroactive application.
 *
 * Rules only ever fill a missing category. They never overwrite a category the
 * user (or the CSV) already set, and they never touch transfers.
 */

const CATEGORY_SELECT = { select: { id: true, name: true, kind: true, color: true } } as const;

async function assertCategory(workspaceId: string, categoryId: string): Promise<void> {
  const category = await prisma.category.findFirst({
    where: { id: categoryId, workspaceId },
    select: { id: true },
  });
  if (!category) throw new NotFoundError('Category');
}

export async function listCategoryRules(workspaceId: string): Promise<CategoryRuleDTO[]> {
  const rows = await prisma.categoryRule.findMany({
    where: { workspaceId },
    include: { category: CATEGORY_SELECT },
  });

  // Returned in evaluation order, so the list the user sees is the list that
  // runs. Same precedence keys as the matcher: priority, then specificity.
  return rows
    .map<CategoryRuleDTO>((row) => toCategoryRuleDTO(row))
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      if (a.pattern.length !== b.pattern.length) return b.pattern.length - a.pattern.length;
      return a.id.localeCompare(b.id);
    });
}

export async function getCategoryRule(workspaceId: string, id: string): Promise<CategoryRuleDTO> {
  const row = await prisma.categoryRule.findFirst({
    where: { id, workspaceId },
    include: { category: CATEGORY_SELECT },
  });
  if (!row) throw new NotFoundError('Category rule');
  return toCategoryRuleDTO(row);
}

export async function createCategoryRule(
  workspaceId: string,
  input: CreateCategoryRuleInput,
): Promise<CategoryRuleDTO> {
  await assertCategory(workspaceId, input.categoryId);
  const pattern = normalizePattern(input.pattern);

  const existing = await prisma.categoryRule.findFirst({
    where: { workspaceId, matchField: input.matchField, pattern },
    select: { id: true },
  });
  if (existing) {
    throw new ConflictError(`A ${input.matchField.toLowerCase()} rule for "${pattern}" already exists`);
  }

  const row = await prisma.categoryRule.create({
    data: {
      workspaceId,
      matchField: input.matchField,
      pattern,
      categoryId: input.categoryId,
      priority: input.priority ?? 100,
      isActive: input.isActive ?? true,
    },
    include: { category: CATEGORY_SELECT },
  });
  return toCategoryRuleDTO(row);
}

export async function updateCategoryRule(
  workspaceId: string,
  id: string,
  input: UpdateCategoryRuleInput,
): Promise<CategoryRuleDTO> {
  const existing = await prisma.categoryRule.findFirst({ where: { id, workspaceId }, select: { id: true } });
  if (!existing) throw new NotFoundError('Category rule');

  if (input.categoryId) await assertCategory(workspaceId, input.categoryId);

  const pattern = input.pattern === undefined ? undefined : normalizePattern(input.pattern);
  const matchField: RuleMatchField | undefined = input.matchField;

  if (pattern !== undefined || matchField !== undefined) {
    const current = await prisma.categoryRule.findFirstOrThrow({
      where: { id },
      select: { matchField: true, pattern: true },
    });
    const clash = await prisma.categoryRule.findFirst({
      where: {
        workspaceId,
        matchField: matchField ?? current.matchField,
        pattern: pattern ?? current.pattern,
        id: { not: id },
      },
      select: { id: true },
    });
    if (clash) throw new ConflictError('Another rule with the same field and pattern already exists');
  }

  const row = await prisma.categoryRule.update({
    where: { id },
    data: {
      ...(matchField !== undefined ? { matchField } : {}),
      ...(pattern !== undefined ? { pattern } : {}),
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
    include: { category: CATEGORY_SELECT },
  });
  return toCategoryRuleDTO(row);
}

export async function deleteCategoryRule(workspaceId: string, id: string): Promise<void> {
  const existing = await prisma.categoryRule.findFirst({ where: { id, workspaceId }, select: { id: true } });
  if (!existing) throw new NotFoundError('Category rule');
  await prisma.categoryRule.delete({ where: { id } });
}

/** Which rule, if any, would categorise this row. Used by imports and the API. */
export async function ruleCategoryFor(
  workspaceId: string,
  input: { description: string; merchant: string | null; type: Parameters<typeof firstMatch>[1]['type'] },
  rules?: readonly LoadedRule[],
): Promise<{ ruleId: string; categoryId: string } | null> {
  const candidates = rules ?? (await loadActiveRules(workspaceId));
  return firstMatch(candidates, input);
}

/**
 * Applies rules to existing uncategorised transactions.
 *
 * Defaults to a dry run: `dryRun` must be explicitly set to `false` to write.
 * Rows that already have a category are never modified, and transfers are
 * skipped. Each row is assigned by the first matching rule only.
 */
export async function applyCategoryRules(
  workspaceId: string,
  input: ApplyCategoryRulesInput,
): Promise<CategoryRuleApplyResultDTO> {
  const dryRun = input.dryRun ?? true;
  const includeReviewed = input.includeReviewed ?? false;

  const rules = await loadActiveRules(workspaceId);

  const rows = await prisma.transaction.findMany({
    where: {
      workspaceId,
      categoryId: null,
      type: { in: ['INCOME', 'EXPENSE', 'REFUND'] },
      ...(includeReviewed ? {} : { reviewStatus: 'NEEDS_REVIEW' }),
    },
    select: { id: true, description: true, merchant: true, type: true },
    orderBy: { transactionDate: 'asc' },
  });

  const perRule = new Map<string, number>();
  const perCategory = new Map<string, number>();
  const assignments: { id: string; categoryId: string }[] = [];

  for (const row of rows) {
    const match = firstMatch(rules, { description: row.description, merchant: row.merchant, type: row.type });
    if (!match) continue;
    assignments.push({ id: row.id, categoryId: match.categoryId });
    perRule.set(match.ruleId, (perRule.get(match.ruleId) ?? 0) + 1);
    perCategory.set(match.categoryId, (perCategory.get(match.categoryId) ?? 0) + 1);
  }

  if (!dryRun && assignments.length > 0) {
    await prisma.$transaction(
      assignments.map((assignment) =>
        prisma.transaction.update({
          where: { id: assignment.id },
          data: { categoryId: assignment.categoryId },
        }),
      ),
    );
  }

  const categoryNames = new Map(
    (
      await prisma.category.findMany({
        where: { workspaceId, id: { in: [...perCategory.keys()] } },
        select: { id: true, name: true },
      })
    ).map((category) => [category.id, category.name]),
  );

  return {
    dryRun,
    scanned: rows.length,
    matched: assignments.length,
    updated: dryRun ? 0 : assignments.length,
    perRule: rules
      .filter((rule) => (perRule.get(rule.id) ?? 0) > 0)
      .map((rule) => ({
        ruleId: rule.id,
        pattern: rule.pattern,
        matchField: rule.matchField,
        categoryId: rule.categoryId,
        matched: perRule.get(rule.id) ?? 0,
      })),
    perCategory: [...perCategory.entries()].map(([categoryId, matched]) => ({
      categoryId,
      categoryName: categoryNames.get(categoryId) ?? 'Unknown',
      matched,
    })),
  };
}
