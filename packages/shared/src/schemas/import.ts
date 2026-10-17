import { z } from 'zod';

import { idSchema } from './common.ts';

/** Columns from the user's CSV that can be mapped onto SpendScope fields. */
export const IMPORT_TARGET_FIELDS = [
  'date',
  'description',
  'amount',
  'credit',
  'type',
  'category',
  'merchant',
  'notes',
] as const;
export type ImportTargetField = (typeof IMPORT_TARGET_FIELDS)[number];

const headerName = z.string().trim().min(1).max(200);

/**
 * Full mapping. `date`, `description` and `amount` are required to validate.
 *
 * `amount` is the primary amount column (normally the debit/withdrawal column
 * when a bank exports a separate one). `credit` is optional and, when mapped,
 * supplies deposit amounts: a row is read as an expense when the amount column
 * has a value, otherwise as income from the credit column.
 */
export const columnMappingSchema = z.object({
  date: headerName,
  description: headerName,
  amount: headerName,
  credit: headerName.nullish(),
  type: headerName.nullish(),
  category: headerName.nullish(),
  merchant: headerName.nullish(),
  notes: headerName.nullish(),
});
export type ColumnMapping = z.infer<typeof columnMappingSchema>;

export const partialColumnMappingSchema = columnMappingSchema.partial();
export type PartialColumnMapping = z.infer<typeof partialColumnMappingSchema>;

/**
 * Stage 2 → 3 request. Either upload `content` (with a `filename`) or re-use an
 * existing server-side `previewId` while changing the `mapping`. The server
 * never trusts client-side validation results — it re-parses and re-validates.
 */
export const importPreviewSchema = z
  .object({
    previewId: idSchema.optional(),
    filename: z.string().trim().min(1).max(255).optional(),
    content: z.string().min(1, 'CSV content is required').optional(),
    mapping: partialColumnMappingSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.previewId && !value.content) {
      ctx.addIssue({
        code: 'custom',
        message: 'Provide either `content` (with `filename`) or an existing `previewId`.',
        path: ['content'],
      });
    }
    if (!value.previewId && !value.filename) {
      ctx.addIssue({
        code: 'custom',
        message: '`filename` is required when uploading content.',
        path: ['filename'],
      });
    }
  });
export type ImportPreviewInput = z.infer<typeof importPreviewSchema>;

/** Stage 5: commit a previously validated preview. */
export const importCommitSchema = z.object({
  previewId: idSchema,
  /**
   * `skip_invalid` imports the valid rows and reports the rest.
   * `block_on_invalid` refuses to import anything when any row is invalid.
   */
  mode: z.enum(['skip_invalid', 'block_on_invalid']).default('skip_invalid'),
  /** Import rows whose fingerprint already exists in the database. */
  importDuplicates: z.boolean().default(false),
  /** Mark every imported row as REVIEWED instead of NEEDS_REVIEW. */
  markReviewed: z.boolean().default(false),
  /** Per-row category decisions taken in the wizard. */
  categoryOverrides: z
    .array(
      z.object({
        rowIndex: z.number().int().min(0),
        categoryId: idSchema.nullish(),
      }),
    )
    .max(20_000)
    .default([]),
});
export type ImportCommitInput = z.infer<typeof importCommitSchema>;

export const importHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ImportHistoryQuery = z.infer<typeof importHistoryQuerySchema>;
