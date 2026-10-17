import { Router } from 'express';

import { analyticsQuerySchema, type AnalyticsQuery } from '@spendscope/shared';

import { queryOf, validateQuery } from '../../middleware/validate.ts';
import { workspaceIdOf } from '../../middleware/workspace.ts';
import {
  getCategoryBreakdown,
  getDashboard,
  getLargestExpenses,
  getMonthlyTrend,
  getRecentTransactions,
  getSummary,
  getTimeSeries,
  resolveQueryPeriod,
} from './analytics.service.ts';

export const analyticsRouter: Router = Router();

analyticsRouter.get('/summary', validateQuery(analyticsQuerySchema), async (_req, res) => {
  res.json({ data: await getSummary(workspaceIdOf(res), queryOf<AnalyticsQuery>(res)) });
});

analyticsRouter.get('/dashboard', validateQuery(analyticsQuerySchema), async (_req, res) => {
  res.json({ data: await getDashboard(workspaceIdOf(res), queryOf<AnalyticsQuery>(res)) });
});

analyticsRouter.get('/time-series', validateQuery(analyticsQuerySchema), async (_req, res) => {
  const query = queryOf<AnalyticsQuery>(res);
  const { period, granularity } = resolveQueryPeriod(query);
  res.json({ data: await getTimeSeries(workspaceIdOf(res), period, granularity) });
});

analyticsRouter.get('/categories', validateQuery(analyticsQuerySchema), async (_req, res) => {
  const query = queryOf<AnalyticsQuery>(res);
  const { period } = resolveQueryPeriod(query);
  res.json({ data: await getCategoryBreakdown(workspaceIdOf(res), period) });
});

analyticsRouter.get('/monthly-trend', validateQuery(analyticsQuerySchema), async (_req, res) => {
  const query = queryOf<AnalyticsQuery>(res);
  const { period } = resolveQueryPeriod(query);
  res.json({ data: await getMonthlyTrend(workspaceIdOf(res), period) });
});

analyticsRouter.get('/recent-transactions', validateQuery(analyticsQuerySchema), async (_req, res) => {
  const query = queryOf<AnalyticsQuery>(res);
  const { period } = resolveQueryPeriod(query);
  res.json({ data: await getRecentTransactions(workspaceIdOf(res), period, query.recentLimit) });
});

analyticsRouter.get('/largest-expenses', validateQuery(analyticsQuerySchema), async (_req, res) => {
  const query = queryOf<AnalyticsQuery>(res);
  const { period } = resolveQueryPeriod(query);
  res.json({ data: await getLargestExpenses(workspaceIdOf(res), period, 10) });
});
