import cors from 'cors';
import express, { type Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';

import { env } from './config/env.ts';
import { logger } from './lib/logger.ts';
import { attachSession, requireAuth } from './middleware/auth.ts';
import { requireTrustedOrigin } from './middleware/csrf.ts';
import { errorHandler, notFoundHandler } from './middleware/validate.ts';
import { analyticsRouter } from './modules/analytics/analytics.routes.ts';
import { createAuthRouter } from './modules/auth/auth.routes.ts';
import { budgetsRouter } from './modules/budgets/budgets.routes.ts';
import { categoriesRouter } from './modules/categories/categories.routes.ts';
import { healthRouter } from './modules/health/health.routes.ts';
import { importsRouter } from './modules/imports/imports.routes.ts';
import { settingsRouter } from './modules/settings/settings.routes.ts';
import { transactionsRouter } from './modules/transactions/transactions.routes.ts';

/**
 * Express application factory.
 *
 * Security posture:
 *   - CORS is restricted to the configured frontend origin(s); credentials are
 *     never sent cross-origin.
 *   - `helmet` safe defaults (CSP disabled: the API serves JSON/CSV, not HTML).
 *   - Session cookie authentication (`HttpOnly`, `SameSite=Lax`, `Secure` in
 *     production) resolved once per request by `attachSession`.
 *   - An origin check on state-changing requests (CSRF defence in depth).
 *   - Every data route requires an authenticated session and is scoped to the
 *     workspace that session owns.
 *   - Request bodies are capped at the configured CSV size.
 *   - Sensitive endpoints are rate-limited.
 */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

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
        // A foreign origin is not an error here: no CORS headers are sent, the
        // browser blocks the response, and `requireTrustedOrigin` turns
        // state-changing requests into a clean 403.
        callback(null, !origin || env.corsOrigins.includes(origin));
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
        ignore: (req) => req.url === '/api/v1/health' || req.url === '/api/v1/ready',
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

  // Liveness/readiness does not require a session.
  app.use('/api/v1/health', healthRouter);

  const v1 = express.Router();
  v1.use(attachSession);
  v1.use(requireTrustedOrigin);

  // Authentication endpoints are public (they create or destroy a session).
  v1.use('/auth', createAuthRouter());

  // Everything below requires a live session.
  const protectedApi = express.Router();
  protectedApi.use(requireAuth);
  protectedApi.use('/transactions', writeLimiter, transactionsRouter);
  protectedApi.use('/categories', writeLimiter, categoriesRouter);
  protectedApi.use('/budgets', writeLimiter, budgetsRouter);
  protectedApi.use('/analytics', analyticsRouter);
  protectedApi.use('/imports', importLimiter, importsRouter);
  protectedApi.use('/settings', writeLimiter, settingsRouter);
  v1.use(protectedApi);

  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
