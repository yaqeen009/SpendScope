import { Router } from 'express';
import { z } from 'zod';

import { dismissRecurringSchema, recurringQuerySchema, type RecurringQuery } from '@spendscope/shared';

import { paramsOf, queryOf, validateBody, validateParams, validateQuery } from '../../middleware/validate.ts';
import { workspaceIdOf } from '../../middleware/workspace.ts';
import { dismissRecurringSeries, listRecurringSeries, undismissRecurringSeries } from './recurring.service.ts';

const keyParamsSchema = z.object({ seriesKey: z.string().min(1).max(400) });

export const recurringRouter: Router = Router();

/**
 * Detected recurring series.
 *
 * Heuristic and advisory: nothing is created or changed. Dismissed series are
 * hidden unless `includeDismissed=true`.
 */
recurringRouter.get('/', validateQuery(recurringQuerySchema), async (_req, res) => {
  const query = queryOf<RecurringQuery>(res);
  res.json({ data: await listRecurringSeries(workspaceIdOf(res), query) });
});

recurringRouter.post('/dismiss', validateBody(dismissRecurringSchema), async (req, res) => {
  res.status(201).json({ data: await dismissRecurringSeries(workspaceIdOf(res), req.body) });
});

recurringRouter.delete('/dismiss/:seriesKey', validateParams(keyParamsSchema), async (_req, res) => {
  const { seriesKey } = paramsOf<{ seriesKey: string }>(res);
  await undismissRecurringSeries(workspaceIdOf(res), seriesKey);
  res.status(204).end();
});
