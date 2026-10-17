import { Router } from 'express';

import { exportQuerySchema, restoreBackupSchema, type ExportQuery } from '@spendscope/shared';

import { queryOf, validateBody, validateQuery } from '../../middleware/validate.ts';
import { workspaceIdOf } from '../../middleware/workspace.ts';
import { buildBackup, buildTransactionsCsv, restoreBackup } from './exports.service.ts';

export const exportsRouter: Router = Router();

/** Filtered CSV download. The same filters as the transaction list. */
exportsRouter.get('/transactions.csv', validateQuery(exportQuerySchema), async (_req, res) => {
  const query = queryOf<ExportQuery>(res);
  const { filename, csv, truncated } = await buildTransactionsCsv(workspaceIdOf(res), query);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('X-Total-Truncated', truncated ? 'true' : 'false');
  res.send(csv);
});

/** Complete, versioned JSON snapshot of the workspace. */
exportsRouter.get('/backup.json', async (_req, res) => {
  const backup = await buildBackup(workspaceIdOf(res));
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="spendscope-backup.json"`);
  res.send(JSON.stringify(backup, null, 2));
});

/**
 * Restores a backup into the authenticated workspace.
 *
 * `mode: "replace"` deletes this workspace's data first; `confirm: "RESTORE"`
 * must be present. No other workspace is ever touched.
 */
exportsRouter.post('/restore', validateBody(restoreBackupSchema), async (req, res) => {
  const body = req.body as Parameters<typeof restoreBackup>[1];
  const result = await restoreBackup(workspaceIdOf(res), body);
  res.json({ data: result });
});
