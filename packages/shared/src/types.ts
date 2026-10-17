/**
 * Data-transfer types returned by the API and consumed by the web client.
 *
 * Monetary values are always decimal strings (never numbers) so that no
 * precision is lost in `JSON.parse`. Dates on transactions are `YYYY-MM-DD`;
 * system timestamps are ISO-8601 UTC strings.
 */

import type { AnalyticsQuery } from './schemas/analytics.ts';
import type {
  ChangePasswordInput,
  DeleteAccountInput,
  LoginInput,
  RegisterInput,
  UpdateProfileInput,
} from './schemas/auth.ts';
import type { BudgetQuery, CreateBudgetInput, UpdateBudgetInput } from './schemas/budget.ts';
import type { CreateCategoryInput, UpdateCategoryInput } from './schemas/category.ts';
import type {
  ApplyCategoryRulesInput,
  CreateCategoryRuleInput,
  UpdateCategoryRuleInput,
} from './schemas/category-rule.ts';
import type { ColumnMapping } from './schemas/import.ts';
import type { UpdateSettingsInput } from './schemas/settings.ts';
import type {
  CreateTransactionInput,
  TransactionQuery,
} from './schemas/transaction.ts';
import type {
  CategoryKind,
  ImportStatus,
  RecurrenceCadence,
  ReviewStatus,
  RuleMatchField,
  TransactionType,
} from './enums.ts';
import type { DateRange, Granularity, PeriodKey } from './periods.ts';
import type { ThemePreference } from './schemas/settings.ts';

export type {
  AnalyticsQuery,
  ApplyCategoryRulesInput,
  BudgetQuery,
  CategoryKind,
  ChangePasswordInput,
  ColumnMapping,
  CreateBudgetInput,
  CreateCategoryInput,
  CreateCategoryRuleInput,
  CreateTransactionInput,
  DateRange,
  DeleteAccountInput,
  Granularity,
  ImportStatus,
  LoginInput,
  PeriodKey,
  RecurrenceCadence,
  RegisterInput,
  ReviewStatus,
  RuleMatchField,
  ThemePreference,
  TransactionQuery,
  TransactionType,
  UpdateBudgetInput,
  UpdateCategoryInput,
  UpdateCategoryRuleInput,
  UpdateProfileInput,
  UpdateSettingsInput,
};
export type { UpdateTransactionInput } from './schemas/transaction.ts';

// ---------------------------------------------------------------------------
// Envelopes
// ---------------------------------------------------------------------------

export interface ApiSuccess<T> {
  data: T;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    /** Field-level validation issues; never contains stack traces. */
    details?: unknown;
  };
}

export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// ---------------------------------------------------------------------------
// Core entities
// ---------------------------------------------------------------------------

export interface CategoryRef {
  id: string;
  name: string;
  kind: CategoryKind;
  color: string | null;
}

export interface CategoryDTO extends CategoryRef {
  description: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  transactionCount: number;
  /** Sum of qualifying expense magnitudes for EXPENSE categories, income for INCOME categories. */
  lifetimeTotal: string;
}

export interface TransactionDTO {
  id: string;
  transactionDate: string;
  description: string;
  merchant: string | null;
  amount: string;
  type: TransactionType;
  categoryId: string | null;
  category: CategoryRef | null;
  notes: string | null;
  reviewStatus: ReviewStatus;
  importBatchId: string | null;
  fingerprint: string | null;
  isSample: boolean;
  /** For REFUND rows: the EXPENSE this refund reverses. */
  refundOfTransactionId: string | null;
  /** Shared id when two rows are a manually paired account transfer. */
  transferGroupId: string | null;
  /**
   * ISO-4217 code of `amount`, or `null` when the row is in the workspace base
   * currency. Foreign-currency rows are excluded from aggregated totals.
   */
  currency: string | null;
  /**
   * Only present on `GET /transactions/:id` for EXPENSE rows: the amount already
   * refunded by linked REFUND rows, so a client can prevent over-refunding.
   */
  refundedAmount?: string;
  createdAt: string;
  updatedAt: string;
}

/** A suggested pair of transfer rows that probably represent one movement. */
export interface TransferSuggestionDTO {
  /** The two candidate TRANSFER rows (order is not significant). */
  a: TransactionDTO;
  b: TransactionDTO;
  /** Absolute difference in days between the two rows. */
  dayGap: number;
  /** Human-readable rationale, safe to display. */
  reason: string;
}

export interface BudgetDTO {
  id: string;
  month: string;
  amount: string;
  categoryId: string | null;
  category: CategoryRef | null;
  createdAt: string;
  updatedAt: string;
}

/** A user-defined rule that fills in a missing category. */
export interface CategoryRuleDTO {
  id: string;
  matchField: RuleMatchField;
  pattern: string;
  categoryId: string;
  category: CategoryRef | null;
  /** Lower number = higher precedence. */
  priority: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * A detected recurring transaction series.
 *
 * Detection is heuristic and explainable: the same amount appears at a regular
 * interval. `explanation` states why the series was detected, and nothing is
 * ever created or changed from it.
 */
export interface RecurringSeriesDTO {
  /** Stable identity, also used to remember a dismissal. */
  seriesKey: string;
  name: string;
  amount: string;
  type: TransactionType;
  cadence: RecurrenceCadence;
  intervalDays: number;
  occurrences: number;
  firstDate: string;
  lastDate: string;
  nextExpectedDate: string;
  confidence: 'medium' | 'high';
  transactionIds: string[];
  /** Human-readable justification, safe to show to the user. */
  explanation: string;
  dismissed: boolean;
}

/** Result of applying category rules, in dry-run or live mode. */export interface CategoryRuleApplyResultDTO {
  dryRun: boolean;
  /** Rows examined (uncategorised rows, or all rows when including reviewed). */
  scanned: number;
  /** Rows a rule could categorise. */
  matched: number;
  /** Rows actually written. Always 0 in a dry run. */
  updated: number;
  /** Per-rule counts, ordered by precedence. */
  perRule: { ruleId: string; pattern: string; matchField: RuleMatchField; categoryId: string; matched: number }[];
  /** Matched rows per category, so the user can see where money will land. */
  perCategory: { categoryId: string; categoryName: string; matched: number }[];
}

export interface ImportBatchDTO {
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
  createdAt: string;
  completedAt: string | null;
}

export interface WorkspaceDTO {
  id: string;
  name: string;
  isDemo: boolean;
}

/** Public account fields. Never includes the password hash. */
export interface AuthUserDTO {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

export interface AuthSessionDTO {
  id: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string;
  /** Truncated user-agent for display; null when the client sent none. */
  userAgent: string | null;
  /** True for the session that made the current request. */
  current: boolean;
}

export interface AuthStateDTO {
  user: AuthUserDTO;
  workspace: WorkspaceDTO;
}

export interface SettingsDTO {
  workspaceId: string;
  currency: string;
  locale: string;
  theme: ThemePreference;
  defaultPeriod: PeriodKey;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export interface MetricsRange {
  start: string;
  end: string;
}

export interface PeriodMetrics {
  income: string;
  expenses: string;
  net: string;
  savingsRate: number | null;
  transactionCount: number;
  uncategorizedExpenseTotal: string;
  uncategorizedCount: number;
  /**
   * Rows in a currency other than the workspace's base currency. They are NOT
   * part of the figures above, because SpendScope performs no conversion. The
   * client must show this so a total is never mistaken for complete.
   */
  foreignCurrency: ForeignCurrencyNotice;
}

/** Foreign-currency rows excluded from a total, and which currencies they are in. */
export interface ForeignCurrencyNotice {
  count: number;
  /** Distinct currency codes seen, sorted. */
  currencies: string[];
  /** Per-currency breakdown, so the user can see the size of what was excluded. */
  totals: { currency: string; income: string; expenses: string; count: number }[];
}

export interface PeriodChange {
  income: number | null;
  expenses: number | null;
  net: number | null;
  savingsRate: number | null;
}

export interface SummaryMetricsDTO {
  period: { key: PeriodKey; label: string; start: string; end: string };
  previousPeriod: DateRange | null;
  current: PeriodMetrics;
  previous: PeriodMetrics | null;
  change: PeriodChange | null;
  granularity: Granularity;
}

export interface SeriesPoint {
  bucket: string;
  label: string;
  income: string;
  expenses: string;
  net: string;
}

export interface TimeSeriesDTO {
  granularity: Granularity;
  range: DateRange;
  points: SeriesPoint[];
}

export interface CategoryBreakdownItem {
  categoryId: string | null;
  name: string;
  color: string | null;
  kind: CategoryKind;
  total: string;
  share: number;
  transactionCount: number;
}

export interface CategoryBreakdownDTO {
  range: DateRange;
  total: string;
  items: CategoryBreakdownItem[];
}

export interface MonthlyTrendPoint {
  month: string;
  income: string;
  expenses: string;
  net: string;
}

export interface MonthlyTrendDTO {
  range: DateRange;
  months: MonthlyTrendPoint[];
}

export interface BudgetProgressItem {
  budgetId: string;
  month: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  budgetAmount: string;
  spent: string;
  remaining: string;
  percentUsed: number;
  state: 'ok' | 'warning' | 'exceeded';
  isTotalBudget: boolean;
}

export interface BudgetProgressTotals {
  budgetAmount: string;
  spent: string;
  remaining: string;
  percentUsed: number;
  state: 'ok' | 'warning' | 'exceeded';
}

export interface BudgetProgressDTO {
  month: string;
  items: BudgetProgressItem[];
  total: BudgetProgressTotals | null;
}

export interface Insight {
  id: string;
  severity: 'info' | 'positive' | 'warning';
  title: string;
  detail: string;
}

export interface InsightsDTO {
  insights: Insight[];
}

export interface DashboardDTO {
  summary: SummaryMetricsDTO;
  timeSeries: TimeSeriesDTO;
  categoryBreakdown: CategoryBreakdownDTO;
  monthlyTrend: MonthlyTrendDTO;
  recentTransactions: TransactionDTO[];
  largestExpenses: TransactionDTO[];
  budgetProgress: BudgetProgressDTO;
  insights: InsightsDTO;
  /** True when the database contains no transactions at all. */
  empty: boolean;
}

// ---------------------------------------------------------------------------
// CSV import
// ---------------------------------------------------------------------------

export interface ImportDetectionDTO {
  headers: string[];
  sampleRows: Record<string, string>[];
  rowCount: number;
  delimiter: string;
  hasBom: boolean;
  suggestedMapping: Partial<ColumnMapping>;
}

export interface ImportSummaryDTO {
  total: number;
  valid: number;
  invalid: number;
  duplicatesExact: number;
  duplicatesPossible: number;
  uncategorized: number;
}

export type ImportRowStatus = 'valid' | 'invalid' | 'duplicate_exact' | 'duplicate_possible';

export interface ImportPreviewRowDTO {
  rowIndex: number;
  transactionDate: string | null;
  description: string;
  merchant: string | null;
  amount: string | null;
  type: TransactionType | null;
  categoryName: string | null;
  notes: string | null;
  suggestedCategoryId: string | null;
  suggestedCategoryName: string | null;
  status: ImportRowStatus;
  errors: string[];
  duplicateOfId: string | null;
}

export interface ImportPreviewDTO {
  previewId: string;
  status: 'mapping_required' | 'ready' | 'empty';
  filename: string;
  fileSizeBytes: number;
  detection: ImportDetectionDTO;
  mapping: Partial<ColumnMapping> | null;
  summary: ImportSummaryDTO | null;
  rows: ImportPreviewRowDTO[];
  /** True when `rows` is only the first N rows of a longer file. */
  rowsTruncated: boolean;
  expiresAt: string;
  warnings: string[];
}

export interface ImportCommitResultDTO {
  batch: ImportBatchDTO;
  created: number;
  skippedDuplicates: number;
  rejected: number;
  total: number;
  errors: { rowIndex: number; messages: string[] }[];
}

export interface ImportErrorReportRow {
  rowIndex: number;
  status: ImportRowStatus;
  errors: string;
  transactionDate: string;
  description: string;
  amount: string;
  type: string;
  category: string;
}
