import type {
  BudgetDTO,
  CategoryDTO,
  CategoryKind,
  CategoryRef,
  CategoryRuleDTO,
  ImportBatchDTO,
  ImportStatus,
  ReviewStatus,
  RuleMatchField,
  TransactionDTO,
  TransactionType,
} from '@spendscope/shared';

import { utcDateToDateOnly } from './dates.ts';
import { decimalToString, type Decimal } from './money.ts';

/**
 * Prisma → DTO mappers. Kept in one place so the JSON shape returned by every
 * endpoint stays identical and monetary values are always decimal strings.
 */

export interface CategoryRow {
  id: string;
  name: string;
  kind: CategoryKind;
  color: string | null;
  description: string | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CategoryWithStats extends CategoryRow {
  _count?: { transactions: number };
  transactionCount?: number;
  lifetimeTotal?: Decimal | null;
}

export function toCategoryRef(row: {
  id: string;
  name: string;
  kind: CategoryKind;
  color: string | null;
}): CategoryRef {
  return { id: row.id, name: row.name, kind: row.kind, color: row.color };
}

export function toCategoryDTO(row: CategoryWithStats): CategoryDTO {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    color: row.color,
    description: row.description,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    transactionCount: row.transactionCount ?? row._count?.transactions ?? 0,
    lifetimeTotal: decimalToString(row.lifetimeTotal ?? null),
  };
}

export interface TransactionRow {
  id: string;
  transactionDate: Date;
  description: string;
  merchant: string | null;
  amount: Decimal;
  type: TransactionType;
  categoryId: string | null;
  category?: { id: string; name: string; kind: CategoryKind; color: string | null } | null;
  notes: string | null;
  reviewStatus: ReviewStatus;
  importBatchId: string | null;
  fingerprint: string | null;
  isSample: boolean;
  refundOfTransactionId: string | null;
  transferGroupId: string | null;
  /** `null` means the workspace base currency. */
  currency?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toTransactionDTO(row: TransactionRow, extras: { refundedAmount?: Decimal } = {}): TransactionDTO {
  return {
    id: row.id,
    transactionDate: utcDateToDateOnly(row.transactionDate),
    description: row.description,
    merchant: row.merchant,
    amount: decimalToString(row.amount),
    type: row.type,
    categoryId: row.categoryId,
    category: row.category ? toCategoryRef(row.category) : null,
    notes: row.notes,
    reviewStatus: row.reviewStatus,
    importBatchId: row.importBatchId,
    fingerprint: row.fingerprint,
    isSample: row.isSample,
    refundOfTransactionId: row.refundOfTransactionId,
    transferGroupId: row.transferGroupId,
    currency: row.currency ?? null,
    ...(extras.refundedAmount ? { refundedAmount: decimalToString(extras.refundedAmount) } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface BudgetRow {
  id: string;
  month: Date;
  amount: Decimal;
  categoryId: string | null;
  category?: { id: string; name: string; kind: CategoryKind; color: string | null } | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toBudgetDTO(row: BudgetRow): BudgetDTO {
  return {
    id: row.id,
    month: utcDateToDateOnly(row.month).slice(0, 7),
    amount: decimalToString(row.amount),
    categoryId: row.categoryId,
    category: row.category ? toCategoryRef(row.category) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface CategoryRuleRow {
  id: string;
  matchField: RuleMatchField;
  pattern: string;
  categoryId: string;
  priority: number;
  isActive: boolean;
  category?: { id: string; name: string; kind: CategoryKind; color: string | null } | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toCategoryRuleDTO(row: CategoryRuleRow): CategoryRuleDTO {
  return {
    id: row.id,
    matchField: row.matchField,
    pattern: row.pattern,
    categoryId: row.categoryId,
    category: row.category ? toCategoryRef(row.category) : null,
    priority: row.priority,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface ImportBatchRow {
  id: string;
  filename: string;
  status: ImportStatus;
  totalRows: number;
  createdRows: number;
  duplicateRows: number;
  invalidRows: number;
  skippedRows: number;
  source: string;
  notes: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export function toImportBatchDTO(row: ImportBatchRow): ImportBatchDTO {
  return {
    id: row.id,
    filename: row.filename,
    status: row.status,
    totalRows: row.totalRows,
    createdRows: row.createdRows,
    duplicateRows: row.duplicateRows,
    invalidRows: row.invalidRows,
    skippedRows: row.skippedRows,
    source: row.source,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}
