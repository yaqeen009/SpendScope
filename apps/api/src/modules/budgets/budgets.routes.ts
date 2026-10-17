import { Router } from 'express';
import { z } from 'zod';

import {
  budgetQuerySchema,
  createBudgetSchema,
  idSchema,
  monthKeySchema,
  updateBudgetSchema,
  type BudgetQuery,
} from '@spendscope/shared';

import { paramsOf, queryOf, validateBody, validateParams, validateQuery } from '../../middleware/validate.ts';
import { workspaceIdOf } from '../../middleware/workspace.ts';
import {
  createBudget,
  deleteBudget,
  getBudget,
  getBudgetProgress,
  listBudgets,
  updateBudget,
} from './budgets.service.ts';

const idParamsSchema = z.object({ id: idSchema });
const monthParamsSchema = z.object({ month: monthKeySchema });

export const budgetsRouter: Router = Router();

budgetsRouter.get('/', validateQuery(budgetQuerySchema), async (_req, res) => {
  const query = queryOf<BudgetQuery>(res);
  res.json({ data: await listBudgets(workspaceIdOf(res), query) });
});

budgetsRouter.post('/', validateBody(createBudgetSchema), async (req, res) => {
  res.status(201).json({ data: await createBudget(workspaceIdOf(res), req.body) });
});

budgetsRouter.get('/progress/:month', validateParams(monthParamsSchema), async (_req, res) => {
  const { month } = paramsOf<{ month: string }>(res);
  res.json({ data: await getBudgetProgress(workspaceIdOf(res), month) });
});

budgetsRouter.get('/:id', validateParams(idParamsSchema), async (_req, res) => {
  const { id } = paramsOf<{ id: string }>(res);
  res.json({ data: await getBudget(workspaceIdOf(res), id) });
});

budgetsRouter.patch(
  '/:id',
  validateParams(idParamsSchema),
  validateBody(updateBudgetSchema),
  async (req, res) => {
    const { id } = paramsOf<{ id: string }>(res);
    res.json({ data: await updateBudget(workspaceIdOf(res), id, req.body) });
  },
);

budgetsRouter.delete('/:id', validateParams(idParamsSchema), async (_req, res) => {
  const { id } = paramsOf<{ id: string }>(res);
  await deleteBudget(workspaceIdOf(res), id);
  res.status(204).end();
});
