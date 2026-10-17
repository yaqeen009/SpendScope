import { Router } from 'express';
import { z } from 'zod';

import {
  importCommitSchema,
  importHistoryQuerySchema,
  importPreviewSchema,
  type ImportHistoryQuery,
} from '@spendscope/shared';

import { paramsOf, queryOf, validateBody, validateParams, validateQuery } from '../../middleware/validate.ts';
import { workspaceIdOf } from '../../middleware/workspace.ts';
import {
  buildPreviewErrorReport,
  buildSampleTemplate,
  commitImport,
  getImportBatch,
  listImportBatches,
  previewImport,
} from './imports.service.ts';

const idParamsSchema = z.object({ id: z.string().uuid() });

export const importsRouter: Router = Router();

/** Stage 1 helper: a downloadable CSV template. */
importsRouter.get('/template', (_req, res) => {
  res.type('text/csv').attachment('spendscope-import-template.csv').send(buildSampleTemplate());
});

/** Stage 2/3: parse, detect the mapping, and validate the rows. */
importsRouter.post('/preview', validateBody(importPreviewSchema), async (req, res) => {
  res.json({ data: await previewImport(req.body) });
});

importsRouter.get('/previews/:id/report', validateParams(idParamsSchema), async (_req, res) => {
  const { id } = paramsOf<{ id: string }>(res);
  const report = await buildPreviewErrorReport(id);
  res.type('text/csv').attachment(report.filename).send(report.csv);
});

/** Stage 5: commit a validated preview. */
importsRouter.post('/', validateBody(importCommitSchema), async (req, res) => {
  res.status(201).json({ data: await commitImport(req.body) });
});

importsRouter.get('/', validateQuery(importHistoryQuerySchema), async (_req, res) => {
  const query = queryOf<ImportHistoryQuery>(res);
  res.json(await listImportBatches(workspaceIdOf(res), query.page, query.pageSize));
});

importsRouter.get('/:id', validateParams(idParamsSchema), async (_req, res) => {
  const { id } = paramsOf<{ id: string }>(res);
  res.json({ data: await getImportBatch(workspaceIdOf(res), id) });
});
