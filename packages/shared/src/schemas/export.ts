import { z } from 'zod';

import { transactionQuerySchema } from './transaction.ts';

/**
 * Query for the CSV export. Identical to the transaction list filter (including
 * search, date range, type, category and review status) but without pagination:
 * an export is a whole filtered set, capped by the server.
 */
export const exportQuerySchema = transactionQuerySchema.omit({ page: true, pageSize: true });
export type ExportQuery = z.infer<typeof exportQuerySchema>;
