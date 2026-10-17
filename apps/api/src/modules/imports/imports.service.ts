import {
  addDays,
  compareDateOnly,
  maxDateOnly,
  minDateOnly,
  todayDateOnly,
  type CategoryKind,
  type ColumnMapping,
  type ImportBatchDTO,
  type ImportCommitInput,
  type ImportCommitResultDTO,
  type ImportDetectionDTO,
  type ImportPreviewDTO,
  type ImportPreviewInput,
  type ImportPreviewRowDTO,
  type ImportSummaryDTO,
  type Paginated,
} from '@spendscope/shared';

import { env } from '../../config/env.ts';
import { BadRequestError, NotFoundError } from '../../lib/errors.ts';
import { cleanHeader, parseCsv, toCsv, type Delimiter } from '../../lib/csv.ts';
import { dateOnlyToUtcDate, utcDateToDateOnly } from '../../lib/dates.ts';
import { buildFingerprint, normalizeMerchant } from '../../lib/fingerprint.ts';
import { buildRecords, buildCandidateRows, summarizeCandidates, kindForType, type CandidateRow, type ExistingTransactionIndex, type RawCsvRecord } from '../../lib/import-parse.ts';
import { detectMapping } from '../../lib/import-detect.ts';
import { prisma } from '../../lib/prisma.ts';
import { toImportBatchDTO } from '../../lib/serializers.ts';
import { importPreviewStore } from './preview-store.instance.ts';

export const MAX_IMPORT_ROWS = 20_000;
const PREVIEW_ROWS_RETURNED = 200;
const POSSIBLE_DUPLICATE_SCAN_LIMIT = 20_000;

export function sanitizeFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? 'upload.csv';
  const cleaned = base.replace(/[^\w.\- ]+/g, '_').slice(0, 255).trim();
  return cleaned.length > 0 ? cleaned : 'upload.csv';
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function isMappingComplete(
  mapping: Partial<ColumnMapping> | null | undefined,
): mapping is ColumnMapping {
  return Boolean(mapping?.date && mapping?.description && mapping?.amount);
}

async function buildExistingIndex(
  workspaceId: string,
  candidates: readonly CandidateRow[],
): Promise<{
  index: ExistingTransactionIndex;
  warnings: string[];
  scanTruncated: boolean;
}> {
  const warnings: string[] = [];

  const fingerprints = [...new Set(candidates.map((row) => row.fingerprint).filter((value): value is string => Boolean(value)))];
  const fingerprintMap = new Map<string, string>();

  for (const batch of chunk(fingerprints, 2000)) {
    const rows = await prisma.transaction.findMany({
      where: { workspaceId, fingerprint: { in: batch } },
      select: { id: true, fingerprint: true },
    });
    for (const row of rows) {
      if (row.fingerprint) fingerprintMap.set(row.fingerprint, row.id);
    }
  }

  const dates = candidates
    .map((row) => row.transactionDate)
    .filter((value): value is string => Boolean(value))
    .sort(compareDateOnly);

  const byDateAmount = new Map<string, string[]>();
  let scanTruncated = false;

  if (dates.length > 0) {
    const from = minDateOnly(dates[0]!, dates[dates.length - 1]!);
    const to = maxDateOnly(dates[0]!, dates[dates.length - 1]!);
    const rows = await prisma.transaction.findMany({
      where: {
        workspaceId,
        transactionDate: { gte: dateOnlyToUtcDate(from), lte: dateOnlyToUtcDate(to) },
      },
      select: { id: true, transactionDate: true, amount: true },
      orderBy: { transactionDate: 'asc' },
      take: POSSIBLE_DUPLICATE_SCAN_LIMIT + 1,
    });

    if (rows.length > POSSIBLE_DUPLICATE_SCAN_LIMIT) {
      scanTruncated = true;
      warnings.push(
        'The possible-duplicate scan was limited to the most recent transactions in this date range; some ambiguous matches may not be flagged.',
      );
    }

    for (const row of rows.slice(0, POSSIBLE_DUPLICATE_SCAN_LIMIT)) {
      const key = `${utcDateToDateOnly(row.transactionDate)}|${row.amount.toFixed(2)}`;
      const list = byDateAmount.get(key);
      if (list) list.push(row.id);
      else byDateAmount.set(key, [row.id]);
    }
  }

  return {
    index: { fingerprints: fingerprintMap, byDateAmount },
    warnings,
    scanTruncated,
  };
}

async function loadCategoryIndex(workspaceId: string): Promise<{
  byNameAndKind: Map<string, string>;
  kindById: Map<string, CategoryKind>;
  ids: Set<string>;
}> {
  const categories = await prisma.category.findMany({
    where: { workspaceId },
    select: { id: true, name: true, kind: true },
  });
  const byNameAndKind = new Map<string, string>();
  const kindById = new Map<string, CategoryKind>();
  const ids = new Set<string>();
  for (const category of categories) {
    byNameAndKind.set(`${category.name.toLowerCase()}|${category.kind}`, category.id);
    kindById.set(category.id, category.kind);
    ids.add(category.id);
  }
  return { byNameAndKind, kindById, ids };
}

function resolveCategoryId(
  candidate: CandidateRow,
  categories: { byNameAndKind: Map<string, string> },
): string | null {
  if (!candidate.type) return null;
  const kind: CategoryKind = kindForType(candidate.type);
  const name = candidate.categoryName ?? candidate.suggestedCategoryName;
  if (!name) return null;
  return categories.byNameAndKind.get(`${name.toLowerCase()}|${kind}`) ?? null;
}

function toPreviewRowDTO(
  candidate: CandidateRow,
  categories: { byNameAndKind: Map<string, string> },
): ImportPreviewRowDTO {
  const suggestedCategoryId = resolveCategoryId(candidate, categories);
  const kind: CategoryKind | null = candidate.type ? kindForType(candidate.type) : null;
  const suggestedName =
    candidate.categoryName ??
    (kind ? (candidate.suggestedCategoryName ?? null) : null) ??
    null;

  return {
    rowIndex: candidate.rowIndex,
    transactionDate: candidate.transactionDate,
    description: candidate.description,
    merchant: candidate.merchant,
    amount: candidate.amount,
    type: candidate.type,
    categoryName: candidate.categoryName,
    notes: candidate.notes,
    suggestedCategoryId,
    suggestedCategoryName: suggestedCategoryId ? suggestedName : null,
    status: candidate.status,
    errors: candidate.errors,
    duplicateOfId: candidate.duplicateOfId,
  };
}

interface ParsedSource {
  filename: string;
  fileSizeBytes: number;
  headers: string[];
  records: RawCsvRecord[];
  delimiter: Delimiter;
  hasBom: boolean;
  csvWarnings: string[];
}

function parseSource(filename: string, content: string): ParsedSource {
  const fileSizeBytes = Buffer.byteLength(content, 'utf8');
  if (fileSizeBytes > env.MAX_UPLOAD_BYTES) {
    throw new BadRequestError(
      `The file is larger than the ${Math.round(env.MAX_UPLOAD_BYTES / 1024)} KB limit`,
    );
  }

  const parsed = parseCsv(content);
  if (parsed.fatal) throw new BadRequestError(parsed.fatal);
  if (parsed.rows.length === 0) {
    return {
      filename,
      fileSizeBytes,
      headers: [],
      records: [],
      delimiter: parsed.delimiter,
      hasBom: parsed.hasBom,
      csvWarnings: parsed.warnings,
    };
  }

  const rawHeaders = parsed.rows[0]!;
  const headers = rawHeaders.map((header, index) => {
    const cleaned = cleanHeader(header);
    return cleaned.length > 0 ? cleaned : `Column ${index + 1}`;
  });

  const dataRows = parsed.rows
    .slice(1)
    .filter((row) => row.some((cellValue) => cellValue.trim().length > 0));

  if (dataRows.length > MAX_IMPORT_ROWS) {
    throw new BadRequestError(
      `The file has ${dataRows.length} rows; the maximum supported per import is ${MAX_IMPORT_ROWS}.`,
    );
  }

  const { records, warnings } = buildRecords(headers, dataRows);

  return {
    filename,
    fileSizeBytes,
    headers,
    records,
    delimiter: parsed.delimiter,
    hasBom: parsed.hasBom,
    csvWarnings: [...parsed.warnings, ...warnings],
  };
}

export async function previewImport(
  workspaceId: string,
  input: ImportPreviewInput,
): Promise<ImportPreviewDTO> {
  let source: ParsedSource;
  if (input.previewId) {
    const stored = importPreviewStore.get(input.previewId);
    if (!stored || stored.workspaceId !== workspaceId) {
      throw new NotFoundError('Import preview (it may have expired — upload the file again)');
    }
    source = {
      filename: stored.filename,
      fileSizeBytes: stored.fileSizeBytes,
      headers: stored.headers,
      records: stored.records,
      delimiter: stored.detection.delimiter as Delimiter,
      hasBom: stored.detection.hasBom,
      csvWarnings: stored.warnings,
    };
  } else {
    if (!input.content || !input.filename) {
      throw new BadRequestError('A CSV file is required');
    }
    source = parseSource(sanitizeFilename(input.filename), input.content);
  }

  const detection = detectMapping(source.headers);
  const effectiveMapping: Partial<ColumnMapping> = input.mapping ?? detection.mapping;

  const detectionDTO: ImportDetectionDTO = {
    headers: source.headers,
    sampleRows: source.records.slice(0, 5).map((record) => record.values),
    rowCount: source.records.length,
    delimiter: source.delimiter,
    hasBom: source.hasBom,
    suggestedMapping: detection.mapping,
  };

  const warnings = [...source.csvWarnings];
  if (source.hasBom) {
    warnings.push('The file starts with a UTF-8 byte-order mark; it was removed automatically.');
  }

  if (source.records.length === 0) {
    return {
      previewId: '',
      status: 'empty',
      filename: source.filename,
      fileSizeBytes: source.fileSizeBytes,
      detection: detectionDTO,
      mapping: input.mapping ?? null,
      summary: null,
      rows: [],
      rowsTruncated: false,
      expiresAt: new Date().toISOString(),
      warnings: [...warnings, 'The file has headers but no data rows.'],
    };
  }

  if (!isMappingComplete(effectiveMapping)) {
    const stored = importPreviewStore.create({
      workspaceId,
      filename: source.filename,
      fileSizeBytes: source.fileSizeBytes,
      headers: source.headers,
      records: source.records,
      detection: detectionDTO,
      warnings,
      mapping: input.mapping ?? null,
    });
    return {
      previewId: stored.id,
      status: 'mapping_required',
      filename: source.filename,
      fileSizeBytes: source.fileSizeBytes,
      detection: detectionDTO,
      mapping: input.mapping ?? null,
      summary: null,
      rows: [],
      rowsTruncated: false,
      expiresAt: new Date(stored.expiresAt).toISOString(),
      warnings,
    };
  }

  const firstPass = buildCandidateRows({
    records: source.records,
    mapping: effectiveMapping,
    existing: { fingerprints: new Map(), byDateAmount: new Map() },
  });
  const { index, warnings: indexWarnings } = await buildExistingIndex(workspaceId, firstPass);
  warnings.push(...indexWarnings);

  const candidates = buildCandidateRows({
    records: source.records,
    mapping: effectiveMapping,
    existing: index,
  });

  const categories = await loadCategoryIndex(workspaceId);
  const summary: ImportSummaryDTO = summarizeCandidates(candidates);

  const stored = importPreviewStore.create({
    workspaceId,
    filename: source.filename,
    fileSizeBytes: source.fileSizeBytes,
    headers: source.headers,
    records: source.records,
    detection: detectionDTO,
    warnings,
    mapping: effectiveMapping,
  });

  return {
    previewId: stored.id,
    status: 'ready',
    filename: source.filename,
    fileSizeBytes: source.fileSizeBytes,
    detection: detectionDTO,
    mapping: effectiveMapping,
    summary,
    rows: candidates.slice(0, PREVIEW_ROWS_RETURNED).map((candidate) => toPreviewRowDTO(candidate, categories)),
    rowsTruncated: candidates.length > PREVIEW_ROWS_RETURNED,
    expiresAt: new Date(stored.expiresAt).toISOString(),
    warnings,
  };
}

export interface CandidateBundle {
  candidates: CandidateRow[];
  mapping: ColumnMapping;
  filename: string;
}

/** Re-derives candidates from the stored preview (never from client data). */
export async function rebuildCandidatesForPreview(
  workspaceId: string,
  previewId: string,
): Promise<CandidateBundle> {
  const stored = importPreviewStore.get(previewId);
  if (!stored || stored.workspaceId !== workspaceId) {
    throw new NotFoundError('Import preview (it may have expired — upload the file again)');
  }
  const mapping = stored.mapping;
  if (!isMappingComplete(mapping)) {
    throw new BadRequestError('The column mapping is incomplete. Map date, description and amount first.');
  }

  const firstPass = buildCandidateRows({
    records: stored.records,
    mapping,
    existing: { fingerprints: new Map(), byDateAmount: new Map() },
  });
  const { index } = await buildExistingIndex(workspaceId, firstPass);
  const candidates = buildCandidateRows({ records: stored.records, mapping, existing: index });

  return { candidates, mapping, filename: stored.filename };
}

export async function commitImport(
  workspaceId: string,
  input: ImportCommitInput,
): Promise<ImportCommitResultDTO> {
  const { candidates, filename } = await rebuildCandidatesForPreview(workspaceId, input.previewId);
  const categories = await loadCategoryIndex(workspaceId);

  const overrides = new Map<number, string | null>();
  for (const override of input.categoryOverrides) {
    const categoryId = override.categoryId ?? null;
    if (categoryId && !categories.ids.has(categoryId)) {
      throw new BadRequestError(`Row ${override.rowIndex + 1} references a category that does not exist`);
    }
    overrides.set(override.rowIndex, categoryId);
  }

  const invalid = candidates.filter((candidate) => candidate.status === 'invalid');
  const exactDuplicates = candidates.filter((candidate) => candidate.status === 'duplicate_exact');
  const possibleDuplicates = candidates.filter((candidate) => candidate.status === 'duplicate_possible');
  const valid = candidates.filter((candidate) => candidate.status === 'valid');

  if (input.mode === 'block_on_invalid' && invalid.length > 0) {
    throw new BadRequestError(
      `Import aborted: ${invalid.length} row${invalid.length === 1 ? '' : 's'} could not be validated. Fix the file or choose to skip invalid rows.`,
      {
        invalidRows: invalid.length,
        firstErrors: invalid.slice(0, 10).map((candidate) => ({
          rowIndex: candidate.rowIndex,
          messages: candidate.errors,
        })),
      },
    );
  }

  const selected: CandidateRow[] = [
    ...valid,
    ...possibleDuplicates,
    ...(input.importDuplicates ? exactDuplicates : []),
  ];

  const skippedDuplicates = input.importDuplicates ? 0 : exactDuplicates.length;

  const toInsert = selected
    .map((candidate) => {
      if (!candidate.transactionDate || !candidate.amount || !candidate.type) return null;
      const categoryId = overrides.has(candidate.rowIndex)
        ? (overrides.get(candidate.rowIndex) ?? null)
        : resolveCategoryId(candidate, categories);

      if (categoryId) {
        const kind = kindForType(candidate.type);
        if (categories.kindById.get(categoryId) !== kind) {
          throw new BadRequestError(
            `Row ${candidate.rowIndex + 1}: the selected category does not match ${candidate.type} transactions`,
          );
        }
      }

      return {
        candidate,
        categoryId,
        data: {
          workspaceId,
          transactionDate: dateOnlyToUtcDate(candidate.transactionDate),
          description: candidate.description,
          merchant: candidate.merchant,
          normalizedMerchant: normalizeMerchant(candidate.merchant),
          amount: candidate.amount,
          type: candidate.type,
          categoryId,
          notes: candidate.notes,
          reviewStatus: input.markReviewed ? ('REVIEWED' as const) : ('NEEDS_REVIEW' as const),
          fingerprint:
            candidate.fingerprint ??
            buildFingerprint({
              transactionDate: candidate.transactionDate,
              description: candidate.description,
              amount: candidate.amount,
              type: candidate.type,
              merchant: candidate.merchant,
            }),
          isSample: false,
        },
      };
    })
    .filter((value): value is NonNullable<typeof value> => value !== null);

  const invalidCount = invalid.length;
  const total = candidates.length;
  const skipped = invalidCount + skippedDuplicates;

  const status = toInsert.length === 0 ? 'FAILED' : skipped > 0 ? 'PARTIAL' : 'COMPLETED';

  const batch = await prisma.$transaction(async (tx) => {
    const createdBatch = await tx.importBatch.create({
      data: {
        workspaceId,
        filename,
        status: 'FAILED',
        totalRows: total,
        createdRows: 0,
        duplicateRows: exactDuplicates.length + possibleDuplicates.length,
        invalidRows: invalidCount,
        skippedRows: skipped,
        source: 'csv',
        notes: buildBatchNotes({ total, created: toInsert.length, skipped, invalidCount, possibleDuplicates: possibleDuplicates.length }),
      },
    });

    if (toInsert.length > 0) {
      await tx.transaction.createMany({
        data: toInsert.map((item) => ({ ...item.data, importBatchId: createdBatch.id })),
      });
    }

    const updated = await tx.importBatch.update({
      where: { id: createdBatch.id },
      data: { status, createdRows: toInsert.length, completedAt: new Date() },
    });

    return updated;
  });

  // A preview is single-use: a second commit with the same id cannot re-import.
  importPreviewStore.delete(input.previewId);

  return {
    batch: toImportBatchDTO(batch),
    created: toInsert.length,
    skippedDuplicates,
    rejected: invalidCount,
    total,
    errors: invalid.slice(0, 100).map((candidate) => ({
      rowIndex: candidate.rowIndex,
      messages: candidate.errors,
    })),
  };
}

function buildBatchNotes(input: {
  total: number;
  created: number;
  skipped: number;
  invalidCount: number;
  possibleDuplicates: number;
}): string {
  const parts = [
    `${input.created} of ${input.total} rows imported`,
    `${input.invalidCount} invalid`,
    `${input.skipped} skipped`,
  ];
  if (input.possibleDuplicates > 0) {
    parts.push(`${input.possibleDuplicates} possible duplicate${input.possibleDuplicates === 1 ? '' : 's'} flagged for review`);
  }
  return parts.join('; ');
}

export async function listImportBatches(
  workspaceId: string,
  page: number,
  pageSize: number,
): Promise<Paginated<ImportBatchDTO>> {
  const [total, rows] = await Promise.all([
    prisma.importBatch.count({ where: { workspaceId } }),
    prisma.importBatch.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    data: rows.map(toImportBatchDTO),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getImportBatch(workspaceId: string, id: string): Promise<ImportBatchDTO> {
  const row = await prisma.importBatch.findFirst({ where: { id, workspaceId } });
  if (!row) throw new NotFoundError('Import batch');
  return toImportBatchDTO(row);
}

/** CSV error report for a live preview, generated server-side and safely escaped. */
export async function buildPreviewErrorReport(
  workspaceId: string,
  previewId: string,
): Promise<{ filename: string; csv: string }> {
  const { candidates, filename } = await rebuildCandidatesForPreview(workspaceId, previewId);

  const rows: string[][] = [
    ['record', 'status', 'errors', 'transaction_date', 'description', 'amount', 'type', 'category'],
  ];

  for (const candidate of candidates) {
    if (candidate.status === 'valid') continue;
    rows.push([
      String(candidate.rowIndex + 1),
      candidate.status,
      candidate.errors.join(' '),
      candidate.transactionDate ?? '',
      candidate.description,
      candidate.amount ?? '',
      candidate.type ?? '',
      candidate.categoryName ?? '',
    ]);
  }

  return { filename: `${filename.replace(/\.csv$/i, '')}-errors.csv`, csv: toCsv(rows) };
}

/** Sample template offered in the wizard (stage 1). */
export function buildSampleTemplate(): string {
  const today = todayDateOnly();
  const rows = [
    ['Date', 'Description', 'Merchant', 'Amount', 'Type', 'Category', 'Notes'],
    [addDays(today, -6), 'Monthly salary', 'Acme Corp', '5200.00', 'INCOME', 'Salary', ''],
    [addDays(today, -4), 'Supermarket shopping', 'ShopRite', '312.45', 'EXPENSE', 'Groceries', 'Weekly shop'],
    [addDays(today, -3), 'Fuel', 'Goil', '180.00', 'EXPENSE', 'Transport', ''],
    [addDays(today, -2), 'Netflix subscription', 'Netflix', '95.00', 'EXPENSE', 'Subscriptions', ''],
    [addDays(today, -1), 'Refund — returned item', 'Jumia', '120.00', 'REFUND', 'Shopping', ''],
    [today, 'Transfer to savings', 'Trust Bank', '500.00', 'TRANSFER', '', 'Excluded from totals'],
  ];
  return toCsv(rows);
}
