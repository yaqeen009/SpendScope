import { Router } from 'express';
import { z } from 'zod';

import {
  applyCategoryRulesSchema,
  createCategoryRuleSchema,
  idSchema,
  updateCategoryRuleSchema,
} from '@spendscope/shared';

import { paramsOf, validateBody, validateParams } from '../../middleware/validate.ts';
import { workspaceIdOf } from '../../middleware/workspace.ts';
import {
  applyCategoryRules,
  createCategoryRule,
  deleteCategoryRule,
  getCategoryRule,
  listCategoryRules,
  updateCategoryRule,
} from './category-rules.service.ts';

const idParamsSchema = z.object({ id: idSchema });

export const categoryRulesRouter: Router = Router();

categoryRulesRouter.get('/', async (_req, res) => {
  res.json({ data: await listCategoryRules(workspaceIdOf(res)) });
});

categoryRulesRouter.get('/:id', validateParams(idParamsSchema), async (_req, res) => {
  const { id } = paramsOf<{ id: string }>(res);
  res.json({ data: await getCategoryRule(workspaceIdOf(res), id) });
});

/**
 * Retroactive application. A dry run is the default: the caller must pass
 * `dryRun: false` to write, and only uncategorised rows are ever changed.
 * Declared before `/:id` so the literal path is not captured as an id.
 */
categoryRulesRouter.post('/apply', validateBody(applyCategoryRulesSchema), async (req, res) => {
  res.json({ data: await applyCategoryRules(workspaceIdOf(res), req.body) });
});

categoryRulesRouter.post('/', validateBody(createCategoryRuleSchema), async (req, res) => {
  res.status(201).json({ data: await createCategoryRule(workspaceIdOf(res), req.body) });
});

categoryRulesRouter.patch('/:id', validateParams(idParamsSchema), validateBody(updateCategoryRuleSchema), async (req, res) => {
  const { id } = paramsOf<{ id: string }>(res);
  res.json({ data: await updateCategoryRule(workspaceIdOf(res), id, req.body) });
});

categoryRulesRouter.delete('/:id', validateParams(idParamsSchema), async (_req, res) => {
  const { id } = paramsOf<{ id: string }>(res);
  await deleteCategoryRule(workspaceIdOf(res), id);
  res.status(204).end();
});
