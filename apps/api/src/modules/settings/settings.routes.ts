import { Router } from 'express';
import { z } from 'zod';

import { updateSettingsSchema } from '@spendscope/shared';

import { validateBody } from '../../middleware/validate.ts';
import { workspaceIdOf } from '../../middleware/workspace.ts';
import { getSettings, manageDemoData, resetData, updateSettings } from './settings.service.ts';

const demoDataSchema = z.object({ action: z.enum(['restore', 'clear']) });
const resetDataSchema = z.object({
  confirm: z.string(),
  includeImported: z.boolean().default(false),
  resetCategories: z.boolean().default(false),
});

export const settingsRouter: Router = Router();

settingsRouter.get('/', async (_req, res) => {
  res.json({ data: await getSettings(workspaceIdOf(res)) });
});

settingsRouter.patch('/', validateBody(updateSettingsSchema), async (req, res) => {
  res.json({ data: await updateSettings(workspaceIdOf(res), req.body) });
});

settingsRouter.post('/demo-data', validateBody(demoDataSchema), async (req, res) => {
  const { action } = req.body as { action: 'restore' | 'clear' };
  res.json({ data: await manageDemoData(workspaceIdOf(res), action) });
});

/** Destructive: requires the literal confirmation token `RESET`. */
settingsRouter.post('/reset', validateBody(resetDataSchema), async (req, res) => {
  const body = req.body as { confirm: string; includeImported: boolean; resetCategories: boolean };
  res.json({ data: await resetData(workspaceIdOf(res), body) });
});
