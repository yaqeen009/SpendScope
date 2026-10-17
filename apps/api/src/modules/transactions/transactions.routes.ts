import { Router } from 'express';
import { z } from 'zod';

import {
  createTransactionSchema,
  idSchema,
  transactionQuerySchema,
  updateTransactionSchema,
  type TransactionQuery,
} from '@spendscope/shared';

import { paramsOf, queryOf, validateBody, validateParams, validateQuery } from '../../middleware/validate.ts';
import { workspaceIdOf } from '../../middleware/workspace.ts';
import {
  createTransaction,
  deleteTransaction,
  getTransaction,
  listTransactions,
  updateTransaction,
} from './transactions.service.ts';

const idParamsSchema = z.object({ id: idSchema });

export const transactionsRouter: Router = Router();

transactionsRouter.get('/', validateQuery(transactionQuerySchema), async (_req, res) => {
  const query = queryOf<TransactionQuery>(res);
  const result = await listTransactions(workspaceIdOf(res), query);
  res.json(result);
});

transactionsRouter.get('/:id', validateParams(idParamsSchema), async (_req, res) => {
  const { id } = paramsOf<{ id: string }>(res);
  res.json({ data: await getTransaction(workspaceIdOf(res), id) });
});

transactionsRouter.post('/', validateBody(createTransactionSchema), async (req, res) => {
  const created = await createTransaction(workspaceIdOf(res), req.body);
  res.status(201).json({ data: created });
});

transactionsRouter.patch(
  '/:id',
  validateParams(idParamsSchema),
  validateBody(updateTransactionSchema),
  async (req, res) => {
    const { id } = paramsOf<{ id: string }>(res);
    res.json({ data: await updateTransaction(workspaceIdOf(res), id, req.body) });
  },
);

transactionsRouter.delete('/:id', validateParams(idParamsSchema), async (_req, res) => {
  const { id } = paramsOf<{ id: string }>(res);
  await deleteTransaction(workspaceIdOf(res), id);
  res.status(204).end();
});
