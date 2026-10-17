import { DEFAULT_CATEGORIES, type SettingsDTO, type ThemePreference, type UpdateSettingsInput } from '@spendscope/shared';

import { BadRequestError } from '../../lib/errors.ts';
import { prisma } from '../../lib/prisma.ts';
import { clearDemoData, resetDemoData } from '../../lib/demo-data.ts';
import { ensureDefaultCategories } from '../workspace/workspace.service.ts';

function toSettingsDTO(row: {
  workspaceId: string;
  currency: string;
  locale: string;
  theme: string;
  defaultPeriod: string;
  updatedAt: Date;
}): SettingsDTO {
  return {
    workspaceId: row.workspaceId,
    currency: row.currency,
    locale: row.locale,
    theme: row.theme as ThemePreference,
    defaultPeriod: row.defaultPeriod as SettingsDTO['defaultPeriod'],
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getSettings(workspaceId: string): Promise<SettingsDTO> {
  const row = await prisma.settings.upsert({
    where: { workspaceId },
    update: {},
    create: { workspaceId },
  });
  return toSettingsDTO(row);
}

export async function updateSettings(
  workspaceId: string,
  input: UpdateSettingsInput,
): Promise<SettingsDTO> {
  await getSettings(workspaceId); // ensure the row exists first
  const row = await prisma.settings.update({
    where: { workspaceId },
    data: {
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
      ...(input.locale !== undefined ? { locale: input.locale } : {}),
      ...(input.theme !== undefined ? { theme: input.theme } : {}),
      ...(input.defaultPeriod !== undefined ? { defaultPeriod: input.defaultPeriod } : {}),
    },
  });
  return toSettingsDTO(row);
}

/** Clear or restore the sample dataset. Never touches imported rows. */
export async function manageDemoData(
  workspaceId: string,
  action: 'restore' | 'clear',
): Promise<{ action: string; transactions: number; budgets: number }> {
  if (action === 'clear') {
    const result = await clearDemoData(workspaceId);
    return { action, ...result };
  }
  const result = await resetDemoData(workspaceId);
  return { action, ...result };
}

export interface ResetDataOptions {
  /** Must equal `RESET` — a guard against accidental destructive calls. */
  confirm: string;
  /** Also delete imported (non-sample) transactions. */
  includeImported: boolean;
  /** Also delete custom categories and reset the catalogue. */
  resetCategories: boolean;
}

/**
 * Destructive workspace reset. Requires an explicit confirmation token so it
 * cannot be triggered by a stray request. Budgets and import history are always
 * removed; transactions only when `includeImported` is true.
 */
export async function resetData(
  workspaceId: string,
  options: ResetDataOptions,
): Promise<{ transactions: number; budgets: number; importBatches: number; categories: number }> {
  if (options.confirm !== 'RESET') {
    throw new BadRequestError('Confirmation token is incorrect. Type RESET to confirm.');
  }

  return prisma.$transaction(async (tx) => {
    const transactionFilter = options.includeImported
      ? { workspaceId }
      : { workspaceId, isSample: true };

    const transactions = await tx.transaction.deleteMany({ where: transactionFilter });
    const budgets = await tx.budget.deleteMany({ where: { workspaceId } });
    const importBatches = await tx.importBatch.deleteMany({ where: { workspaceId } });

    let categories = 0;
    if (options.resetCategories) {
      const deleted = await tx.category.deleteMany({ where: { workspaceId } });
      categories = deleted.count;
      await ensureDefaultCategories(tx, workspaceId);
    }

    return {
      transactions: transactions.count,
      budgets: budgets.count,
      importBatches: importBatches.count,
      categories,
    };
  });
}

export { DEFAULT_CATEGORIES };
