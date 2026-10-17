import cors from 'cors';
import express, { type Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';

import { env } from './config/env.ts';
import { logger } from './lib/logger.ts';
import { errorHandler, notFoundHandler } from './middleware/validate.ts';
import { resolveWorkspace } from './middleware/workspace.ts';
import { analyticsRouter } from './modules/analytics/analytics.routes.ts';
import { budgetsRouter } from './modules/budgets/budgets.routes.ts';
import { categoriesRouter } from './modules/categories/categories.routes.ts';
import { healthRouter } from './modules/health/health.routes.ts';
import { importsRouter } from './modules/imports/imports.routes.ts';
import { settingsRouter } from './modules/settings/settings.routes.ts';
import { transactionsRouter } from './modules/transactions/transactions.routes.ts';

/**
 * Express application factory.
 *
 * Security posture for a local-first finance app:
 *   - CORS is restricted to the configured frontend origin(s).
 *   - `helmet` sets safe defaults; CSP is disabled because the API serves JSON
 *     and CSV only (the SPA is served by Vite/its own host).
 *   - Request bodies are capped at the configured CSV size.
 *   - Sensitive endpoints are rate-limited.
 *   - There is NO authentication in this MVP. The API must run on a trusted
 *     machine or behind an authenticating proxy — see docs/SECURITY.md.
 */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', false);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin / curl requests have no Origin header and are allowed.
        if (!origin || env.corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error('Not allowed by CORS'));
      },
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: false,
      maxAge: 86_400,
    }),
  );

  app.use(
    pinoHttp({
      logger,
      autoLogging: {
        ignore: (req) => req.url === '/api/v1/health',
      },
    }),
  );

  app.use(express.json({ limit: env.MAX_UPLOAD_BYTES }));

  const importLimiter = rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many import requests. Try again shortly.' } },
  });

  const writeLimiter = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again shortly.' } },
  });

  // Health does not require a workspace and is intentionally unauthenticated.
  app.use('/api/v1/health', healthRouter);

  const v1 = express.Router();
  v1.use(resolveWorkspace);
  v1.use('/transactions', writeLimiter, transactionsRouter);
  v1.use('/categories', writeLimiter, categoriesRouter);
  v1.use('/budgets', writeLimiter, budgetsRouter);
  v1.use('/analytics', analyticsRouter);
  v1.use('/imports', importLimiter, importsRouter);
  v1.use('/settings', writeLimiter, settingsRouter);

  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
