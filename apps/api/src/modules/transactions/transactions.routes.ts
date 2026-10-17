import { Router } from 'express';
import { z } from 'zod';

import {
  createTransactionSchema,
  idSchema,
  linkTransferSchema,
  transactionQuerySchema,
  updateTransactionSchema,
  type TransactionQuery,
} from '@spendscope/shared';

import { linkTransfer, suggestTransfers, unlinkTransfer } from '../../lib/transfers.ts';
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

/**
 * Advisory only: returns pairs of unpaired TRANSFER rows that look like the two
 * sides of one movement. Nothing is changed until the user confirms a pairing.
 * Declared before `/:id` so the literal path is not captured as an id.
 */
transactionsRouter.get('/transfer-suggestions', async (_req, res) => {
  res.json({ data: await suggestTransfers(workspaceIdOf(res)) });
});

transactionsRouter.post('/:id/transfer', validateParams(idParamsSchema), validateBody(linkTransferSchema), async (req, res) => {
  const { id } = paramsOf<{ id: string }>(res);
  const { counterpartId } = req.body as { counterpartId: string };
  res.json({ data: await linkTransfer(workspaceIdOf(res), id, counterpartId) });
});

transactionsRouter.delete('/:id/transfer', validateParams(idParamsSchema), async (_req, res) => {
  const { id } = paramsOf<{ id: string }>(res);
  res.json({ data: { unlinked: await unlinkTransfer(workspaceIdOf(res), id) } });
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
