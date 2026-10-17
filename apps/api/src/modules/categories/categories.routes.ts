import { Router } from 'express';
import { z } from 'zod';

import {
  createCategorySchema,
  deleteCategoryQuerySchema,
  idSchema,
  updateCategorySchema,
  type DeleteCategoryQuery,
} from '@spendscope/shared';

import { paramsOf, queryOf, validateBody, validateParams, validateQuery } from '../../middleware/validate.ts';
import { workspaceIdOf } from '../../middleware/workspace.ts';
import {
  createCategory,
  deleteCategory,
  getCategory,
  listCategories,
  updateCategory,
} from './categories.service.ts';

const idParamsSchema = z.object({ id: idSchema });

export const categoriesRouter: Router = Router();

categoriesRouter.get('/', async (_req, res) => {
  res.json({ data: await listCategories(workspaceIdOf(res)) });
});

categoriesRouter.get('/:id', validateParams(idParamsSchema), async (_req, res) => {
  const { id } = paramsOf<{ id: string }>(res);
  res.json({ data: await getCategory(workspaceIdOf(res), id) });
});

categoriesRouter.post('/', validateBody(createCategorySchema), async (req, res) => {
  res.status(201).json({ data: await createCategory(workspaceIdOf(res), req.body) });
});

categoriesRouter.patch(
  '/:id',
  validateParams(idParamsSchema),
  validateBody(updateCategorySchema),
  async (req, res) => {
    const { id } = paramsOf<{ id: string }>(res);
    res.json({ data: await updateCategory(workspaceIdOf(res), id, req.body) });
  },
);

categoriesRouter.delete(
  '/:id',
  validateParams(idParamsSchema),
  validateQuery(deleteCategoryQuerySchema),
  async (_req, res) => {
    const { id } = paramsOf<{ id: string }>(res);
    const options = queryOf<DeleteCategoryQuery>(res);
    res.json({ data: await deleteCategory(workspaceIdOf(res), id, options) });
  },
);
