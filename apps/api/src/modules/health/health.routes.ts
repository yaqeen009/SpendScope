import { Router } from 'express';

import { prisma } from '../../lib/prisma.ts';
import { getWorkspaceId } from '../../modules/workspace/workspace.service.ts';

export const healthRouter: Router = Router();

/**
 * Liveness + database readiness. Deliberately reports only whether the
 * database responded — never connection strings or driver errors.
 */
healthRouter.get('/', async (_req, res) => {
  let database: 'up' | 'down' = 'up';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = 'down';
  }

  const workspaceId = database === 'up' ? await getWorkspaceId().catch(() => null) : null;

  res.status(database === 'up' ? 200 : 503).json({
    data: {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      workspaceReady: workspaceId !== null,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    },
  });
});
