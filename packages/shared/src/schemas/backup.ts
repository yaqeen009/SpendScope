import { z } from 'zod';

import {
  categoryKindSchema,
  dateOnlySchema,
  importStatusSchema,
  moneyStringSchema,
  reviewStatusSchema,
  transactionTypeSchema,
} from './common.ts';
import { RULE_MATCH_FIELDS } from '../enums.ts';
import { THEME_PREFERENCES } from './settings.ts';
import { PERIOD_KEYS } from '../periods.ts';

/**
 * Workspace backup format.
 *
 * A backup is a self-describing JSON document. `version` is explicit so a future
 * change can be detected and handled rather than silently misread.
 *
 * Categories are referenced **by name and kind**, not by id, so a backup can be
 * restored into a workspace whose category ids differ. Transaction ids are kept
 * only to preserve refund links inside the same document.
 */

export const BACKUP_FORMAT = 'spendscope-backup';
export const BACKUP_VERSION = 1;

/** Refuse to restore a document larger than this (rows). */
export const MAX_BACKUP_TRANSACTIONS = 200_000;

export const backupCategorySchema = z.object({
  name: z.string().trim().min(1).max(200),
  kind: categoryKindSchema,
  color: z.string().trim().max(32).nullish(),
  description: z.string().trim().max(1000).nullish(),
  isDefault: z.boolean().optional(),
});

export const backupTransactionSchema = z.object({
  /** Only used to resolve `refundOfId` within this document. */
  id: z.string().max(64).optional(),
  transactionDate: dateOnlySchema,
  description: z.string().trim().min(1).max(500),
  merchant: z.string().trim().max(200).nullish(),
  amount: moneyStringSchema,
  type: transactionTypeSchema,
  /** Categories travel by name; an unknown name leaves the row uncategorised. */
  categoryName: z.string().trim().max(200).nullish(),
  categoryKind: categoryKindSchema.nullish(),
  notes: z.string().trim().max(2000).nullish(),
  reviewStatus: reviewStatusSchema.optional(),
  refundOfId: z.string().max(64).nullish(),
  transferGroupId: z.string().max(64).nullish(),
  importBatchRef: z.string().max(64).nullish(),
  /** ISO-4217 code, or null/absent for the workspace base currency. */
  currency: z.string().trim().max(8).nullish(),
});

export const backupBudgetSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Expected YYYY-MM'),
  amount: moneyStringSchema,
  categoryName: z.string().trim().max(200).nullish(),
  categoryKind: categoryKindSchema.nullish(),
});

export const backupImportBatchSchema = z.object({
  ref: z.string().max(64),
  filename: z.string().trim().min(1).max(255),
  status: importStatusSchema,
  totalRows: z.number().int().min(0),
  createdRows: z.number().int().min(0),
  duplicateRows: z.number().int().min(0),
  invalidRows: z.number().int().min(0),
  skippedRows: z.number().int().min(0),
  notes: z.string().trim().max(2000).nullish(),
});

export const backupCategoryRuleSchema = z.object({
  matchField: z.enum(RULE_MATCH_FIELDS),
  pattern: z.string().trim().min(2).max(120),
  categoryName: z.string().trim().max(200),
  categoryKind: categoryKindSchema,
  priority: z.number().int().min(0).max(10_000),
  isActive: z.boolean(),
});

export const backupSettingsSchema = z.object({
  currency: z.string().trim().min(1).max(8).optional(),
  locale: z.string().trim().min(2).max(20).optional(),
  theme: z.enum(THEME_PREFERENCES).optional(),
  defaultPeriod: z.enum(PERIOD_KEYS).optional(),
});

export const backupDocumentSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(BACKUP_VERSION),
  exportedAt: z.string().max(40),
  workspace: z.object({ name: z.string().trim().max(120) }).optional(),
  settings: backupSettingsSchema.nullish(),
  categories: z.array(backupCategorySchema).max(1000),
  transactions: z.array(backupTransactionSchema).max(MAX_BACKUP_TRANSACTIONS),
  budgets: z.array(backupBudgetSchema).max(5000),
  importBatches: z.array(backupImportBatchSchema).max(5000).optional(),
  categoryRules: z.array(backupCategoryRuleSchema).max(1000).optional(),
});
export type BackupDocument = z.infer<typeof backupDocumentSchema>;

export const restoreBackupSchema = z.object({
  /** `replace` clears this workspace first; `merge` adds to what is there. */
  mode: z.enum(['replace', 'merge']),
  /** Must be exactly `RESTORE`. A restore is destructive under `replace`. */
  confirm: z.literal('RESTORE'),
  backup: backupDocumentSchema,
});
export type RestoreBackupInput = z.infer<typeof restoreBackupSchema>;
