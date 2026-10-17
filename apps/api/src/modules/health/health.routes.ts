import { Router } from 'express';

import { prisma } from '../../lib/prisma.ts';

export const healthRouter: Router = Router();

/**
 * Liveness — is the process serving requests?
 *
 * Deliberately independent of the database: a restart loop must not be
 * triggered by a transient database outage. Reports nothing about
 * configuration or connections.
 */
healthRouter.get('/', (_req, res) => {
  res.json({
    data: {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    },
  });
});

/**
 * Readiness — can the process serve real traffic?
 *
 * Performs a single round-trip to PostgreSQL. Returns 503 when the database
 * does not answer so a load balancer stops routing here. Never includes
 * connection strings, driver errors or record counts.
 */
healthRouter.get('/ready', async (_req, res) => {
  let database: 'up' | 'down' = 'up';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = 'down';
  }

  res.status(database === 'up' ? 200 : 503).json({
    data: {
      status: database === 'up' ? 'ready' : 'degraded',
      database,
      timestamp: new Date().toISOString(),
    },
  });
});
